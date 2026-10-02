// SPDX-License-Identifier: AGPL-3.0-only
//! Deterministic local-view verifier. It never consults a clock, server status or AI.
use crate::{
    actions,
    contract::{self, diagnostic, ensure},
    encoding::{canonical, digest, validate_id},
    evidence,
    model::*,
    money::{Money, parse_minor_units},
    rights,
    transcript::{self, EventBody, EventContext, SignedEvent},
};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Default, Clone)]
struct State {
    obligations: BTreeMap<String, Obligation>,
    effects: Vec<EffectAudit>,
    payments: Vec<PaymentObservation>,
    expense_totals: BTreeMap<String, Money>,
    expense_categories: BTreeMap<String, String>,
    active_services: BTreeSet<(String, String)>,
}
fn error(subject: &str, text: &str, errors: &mut Vec<Diagnostic>) {
    errors.push(diagnostic(subject, text));
}

fn action_map(bundle: &AssignmentBundle) -> Result<BTreeMap<String, ActionCertificate>, String> {
    let mut map: BTreeMap<String, ActionCertificate> = BTreeMap::new();
    for c in &bundle.actions {
        let id = digest(&c.proposal)?;
        if let Some(prior) = map.get_mut(&id) {
            for sig in &c.authorizations {
                if !prior.authorizations.contains(sig) {
                    prior.authorizations.push(sig.clone());
                }
            }
        } else {
            map.insert(id, c.clone());
        }
    }
    Ok(map)
}

/// Only complete, nonconflicted all-party amendment chains introduce new policies.
type AgreementChain = (
    BTreeMap<String, AssignmentContract>,
    String,
    BTreeSet<String>,
);
fn contracts(
    bundle: &AssignmentBundle,
    trust: &TrustConfiguration,
    errors: &mut Vec<Diagnostic>,
    status: &mut BTreeMap<String, String>,
) -> Result<AgreementChain, String> {
    let root = &bundle.agreement.agreement;
    let mut current = digest(root)?;
    let mut map = BTreeMap::from([(current.clone(), root.clone())]);
    let mut accepted = BTreeSet::new();
    let actions = action_map(bundle)?;
    loop {
        let a = &map[&current];
        let mut candidates = vec![];
        for (id, c) in &actions {
            if c.proposal.agreement_hash != current {
                continue;
            }
            let Action::AmendAgreement { replacement } = &c.proposal.action else {
                continue;
            };
            let check = (|| {
                actions::validate_authorizations(c, a)?;
                crate::cutover::validate_amendment(&c.proposal, a, bundle, trust, &map, &accepted)?;
                Ok::<(), String>(())
            })();
            match check {
                Ok(()) => candidates.push((id.clone(), replacement.as_ref().clone())),
                Err(e) => {
                    status.insert(id.clone(), "REJECTED".into());
                    error(id, &e, errors);
                }
            }
        }
        if candidates.is_empty() {
            break;
        }
        if candidates.len() > 1 {
            for (id, _) in candidates {
                status.insert(id.clone(), "CONFLICTED".into());
                error(
                    &id,
                    "EXCLUSIVE_CONFLICT: incompatible fully authorized amendments; no winner selected",
                    errors,
                );
            }
            break;
        }
        let (id, next) = candidates.remove(0);
        let next_hash = digest(&next)?;
        map.insert(next_hash.clone(), next);
        current = next_hash;
        accepted.insert(id.clone());
        status.insert(id, "APPLIED".into());
    }
    Ok((map, current, accepted))
}

pub fn known_contract(
    bundle: &AssignmentBundle,
    hash: &str,
    trust: &TrustConfiguration,
) -> Result<AssignmentContract, String> {
    ensure(
        contract::verify_contract(&bundle.agreement, &bundle.requests, trust).bound,
        "AGREEMENT_UNBOUND",
        "root must be bound",
    )?;
    let (map, _, _) = contracts(bundle, trust, &mut vec![], &mut BTreeMap::new())?;
    map.get(hash).cloned().ok_or_else(|| {
        "UNKNOWN_AGREEMENT: missing, invalid or conflicted Agreement revision".into()
    })
}

fn completion<'a>(
    events: &'a BTreeMap<String, SignedEvent>,
    hash: &str,
    a: &AssignmentContract,
    milestone: Option<&str>,
) -> Result<(&'a str, &'a transcript::EvidenceManifest), String> {
    let e = events.get(hash).ok_or_else(|| {
        "MISSING_EVIDENCE: authenticated, structurally valid Operator completion event required"
            .to_string()
    })?;
    ensure(
        e.envelope.agreement_hash == digest(a)?,
        "COMPLETION_BINDING",
        "completion belongs to another Agreement revision",
    )?;
    let EventBody::CompletionClaim {
        milestone_id,
        manifest,
    } = &e.envelope.body
    else {
        return Err("COMPLETION_TYPE: Operator completion claim required".into());
    };
    ensure(
        milestone.is_none_or(|m| m == milestone_id),
        "COMPLETION_MILESTONE",
        "wrong milestone",
    )?;
    ensure(
        a.quote
            .quote
            .milestones
            .iter()
            .any(|m| &m.id == milestone_id),
        "COMPLETION_MILESTONE",
        "unknown milestone",
    )?;
    Ok((milestone_id, manifest))
}
fn compatible(left: &Money, right: &Money) -> Result<(), String> {
    left.validate()?;
    right.validate()?;
    ensure(
        left.currency == right.currency && left.exponent == right.exponent,
        "MONEY_MISMATCH",
        "currency/exponent mismatch",
    )
}
// Explicit accounting fields make each allowlisted call site auditable.
#[allow(clippy::too_many_arguments)]
fn establish(
    state: &mut State,
    id: &str,
    amount: &Money,
    debtor: Role,
    creditor: Role,
    category: &str,
    a: &AssignmentContract,
    certificate: &str,
    root_hash: &str,
) -> Result<(), String> {
    if let Some(o) = state.obligations.get_mut(id) {
        ensure(
            o.amount == *amount && o.debtor == debtor && o.creditor == creditor,
            "ENTITLEMENT_CONFLICT",
            "incompatible amounts/bindings for existing work unit; accrued claim retained and new claim unresolved",
        )?;
        if !o.certificate_ids.iter().any(|x| x == certificate) {
            o.certificate_ids.push(certificate.into());
        }
        return Ok(());
    }
    state.obligations.insert(
        id.into(),
        Obligation {
            id: id.into(),
            debtor,
            creditor,
            category: category.into(),
            amount: amount.clone(),
            basis_agreement_hash: root_hash.into(),
            certificate_ids: vec![certificate.into()],
            due_conditions: a.payments.due_conditions.clone(),
            disputed_amount: "0".into(),
            discharged_amount: "0".into(),
            released_amount: "0".into(),
            overlap_amount: "0".into(),
            credit_grants: vec![],
            release_grants: vec![],
            unresolved_balance: amount.minor_units.clone(),
        },
    );
    Ok(())
}

fn apply(
    state: &mut State,
    proposal: &ActionProposal,
    id: &str,
    a: &AssignmentContract,
    context: &ReductionContext<'_>,
    authorizers: Vec<Role>,
) -> Result<(), String> {
    let events = context.events;
    let attachments = context.attachments;
    let root_hash = context.root_hash;
    let mut affected = vec![];
    let mut proofs = vec![];
    let rule = proposal.action.kind().to_string();
    let explanation;
    match &proposal.action {
        Action::AcknowledgeCompletion {
            completion_event_hash,
            milestone_id,
        } => {
            completion(events, completion_event_hash, a, Some(milestone_id))?;
            let milestone = a
                .quote
                .quote
                .milestones
                .iter()
                .find(|m| &m.id == milestone_id)
                .ok_or("MILESTONE: unknown")?;
            let oid = format!("milestone:{milestone_id}");
            establish(
                state,
                &oid,
                &milestone.compensation,
                Role::Requester,
                Role::Operator,
                "COMPENSATION",
                a,
                id,
                root_hash,
            )?;
            affected.push(oid);
            proofs.push(completion_event_hash.clone());
            explanation = "Requester acknowledgment applies the compensation previously agreed for this milestone; no waiver or physical-truth certification.";
        }
        Action::InvokeArtifactRule {
            rule_id,
            completion_event_hash,
        } => {
            let rule = a
                .policy
                .artifact_rules
                .iter()
                .find(|r| &r.id == rule_id)
                .ok_or("UNKNOWN_RULE: rule absent from policy")?;
            let (mid, manifest) =
                completion(events, completion_event_hash, a, Some(&rule.milestone_id))?;
            let integrity = evidence::validate_manifest(manifest, attachments);
            ensure(
                integrity.schema_valid,
                "RULE_PROOF",
                "invalid artifact manifest schema",
            )?;
            for hash in &rule.artifact_digests {
                let artifact = integrity
                    .artifacts
                    .iter()
                    .find(|f| &f.sha256 == hash)
                    .ok_or("RULE_PROOF: required digest absent from committed manifest")?;
                ensure(
                    artifact.digest_match == Some(true),
                    "MISSING_EVIDENCE",
                    "exact required artifact bytes not supplied or invalid",
                )?;
                ensure(
                    artifact.length_match == Some(true),
                    "ARTIFACT_SIZE",
                    "manifest byte length mismatch",
                )?;
            }
            let milestone = a
                .quote
                .quote
                .milestones
                .iter()
                .find(|m| m.id == mid)
                .ok_or("MILESTONE: unknown")?;
            let oid = format!("milestone:{mid}");
            establish(
                state,
                &oid,
                &milestone.compensation,
                Role::Requester,
                Role::Operator,
                "COMPENSATION",
                a,
                id,
                root_hash,
            )?;
            affected.push(oid);
            proofs.push(completion_event_hash.clone());
            proofs.extend(rule.artifact_digests.clone());
            explanation = "Pinned digital-artifact rule satisfied; establishes only the preauthorized compensation. It does not prove physical performance.";
        }
        Action::AuthorizeExpense {
            expense_id,
            category,
            amount,
            evidence_event_hash,
        } => {
            validate_id(expense_id)?;
            let e = events
                .get(evidence_event_hash)
                .ok_or("MISSING_EVIDENCE: attributed expense evidence required")?;
            ensure(
                e.envelope.author_role == "O",
                "EXPENSE_EVIDENCE",
                "expense evidence must be Operator-attributed",
            )?;
            let cap = a
                .quote
                .quote
                .expenses
                .iter()
                .find(|e| &e.category == category)
                .ok_or("EXPENSE_CATEGORY: category not quoted")?;
            compatible(amount, &cap.cap)?;
            let oid = format!("expense:{expense_id}");
            ensure(
                state
                    .expense_categories
                    .get(&oid)
                    .is_none_or(|prior| prior == category),
                "ENTITLEMENT_CONFLICT",
                "an expense identity cannot move between quoted categories",
            )?;
            let already_established = state.obligations.contains_key(&oid);
            let prior = state
                .expense_totals
                .get(category)
                .cloned()
                .unwrap_or(Money::new("0", &amount.currency)?);
            let total = if already_established {
                prior
            } else {
                prior.checked_add(amount)?
            };
            ensure(
                total.validate()? <= cap.cap.validate()?,
                "EXPENSE_CAP",
                "authorized expense cap exceeded",
            )?;
            establish(
                state,
                &oid,
                amount,
                Role::Requester,
                Role::Operator,
                "EXPENSE",
                a,
                id,
                root_hash,
            )?;
            state.expense_totals.insert(category.clone(), total);
            state
                .expense_categories
                .insert(oid.clone(), category.clone());
            affected.push(oid);
            proofs.push(evidence_event_hash.clone());
            explanation = "Both task parties authorized the separately itemized expense inside the Operator's quoted cap.";
        }
        Action::BilateralSettlement {
            settlement_id,
            releases,
            reservation_of_other_rights,
        } => {
            validate_id(settlement_id)?;
            contract::text(reservation_of_other_rights)?;
            ensure(
                a.policy.bilateral_balance_releases && !releases.is_empty() && releases.len() <= 64,
                "SETTLEMENT_SCOPE",
                "only enabled, bounded R/O balance releases are supported",
            )?;
            contract::unique(releases.iter().map(|r| r.obligation_id.as_str()))?;
            for release in releases {
                let o = state
                    .obligations
                    .get_mut(&release.obligation_id)
                    .ok_or("MISSING_OBLIGATION: settlement balance absent")?;
                ensure(
                    o.debtor == Role::Requester
                        && o.creditor == Role::Operator
                        && matches!(o.category.as_str(), "COMPENSATION" | "EXPENSE"),
                    "SETTLEMENT_SCOPE",
                    "R/O cannot settle protection claims or change M's rights",
                )?;
                compatible(&o.amount, &release.amount)?;
                ensure(
                    proposal
                        .parent_certificate_ids
                        .iter()
                        .any(|p| o.certificate_ids.contains(p)),
                    "SETTLEMENT_BASIS",
                    "settlement must name an entitlement certificate",
                )?;
                let allocations: Vec<_> = proposal
                    .allocations
                    .iter()
                    .filter(|r| r.obligation_id == o.id)
                    .cloned()
                    .collect();
                rights::grant(o, id, &allocations, &release.amount, true)?;
                proofs.extend(
                    proposal
                        .parent_certificate_ids
                        .iter()
                        .filter(|p| o.certificate_ids.contains(p))
                        .cloned(),
                );
                o.certificate_ids.push(id.into());
                affected.push(o.id.clone());
            }
            ensure(
                proposal
                    .allocations
                    .iter()
                    .all(|r| affected.contains(&r.obligation_id)),
                "ALLOCATION_SCOPE",
                "release allocation names an unrelated obligation",
            )?;
            explanation = "Irrevocable bilateral release of exact R/O debt units. Overlap with receipts is reported and counted once; M's rights are unchanged.";
        }
        Action::PaymentReceipt {
            payment_id,
            obligation_id,
            amount,
            rail_reference,
        } => {
            validate_id(payment_id)?;
            contract::text(rail_reference)?;
            let o = state
                .obligations
                .get_mut(obligation_id)
                .ok_or("MISSING_OBLIGATION: receipt lacks established obligation")?;
            compatible(&o.amount, amount)?;
            ensure(
                authorizers.contains(&o.creditor),
                "PAYEE_AUTHORITY",
                "only actual payee can acknowledge receipt",
            )?;
            ensure(
                proposal
                    .parent_certificate_ids
                    .iter()
                    .any(|p| o.certificate_ids.contains(p)),
                "PAYMENT_BASIS",
                "receipt must identify the entitlement certificate",
            )?;
            let paid = amount.validate()?;
            ensure(
                paid > 0,
                "PAYMENT_AMOUNT",
                "positive receipt amount required",
            )?;
            let applied = rights::allocation_amount(o, &proposal.allocations)?;
            rights::grant(o, id, &proposal.allocations, amount, false)?;
            proofs.extend(
                proposal
                    .parent_certificate_ids
                    .iter()
                    .filter(|p| o.certificate_ids.contains(p))
                    .cloned(),
            );
            o.certificate_ids.push(id.into());
            state.payments.push(PaymentObservation {
                certificate_id: id.into(),
                obligation_id: obligation_id.clone(),
                amount: amount.clone(),
                kind: "PAYEE_SIGNED_RECEIPT".into(),
                discharged_amount: applied.to_string(),
                excess_amount: (paid - applied).to_string(),
                reference: rail_reference.clone(),
            });
            affected.push(obligation_id.clone());
            explanation = "Actual creditor grants discharge of exact signed debt units. Independent grants survive equivocation; their set union is counted once. Excess and bank finality remain separate.";
        }
        Action::ReconcileReversal {
            payment_certificate_id,
            amount,
            reason,
        } => {
            contract::text(reason)?;
            ensure(
                proposal
                    .parent_certificate_ids
                    .contains(payment_certificate_id),
                "REVERSAL_BASIS",
                "original receipt must be a causal parent",
            )?;
            let payment = state
                .payments
                .iter()
                .find(|p| {
                    &p.certificate_id == payment_certificate_id && p.kind == "PAYEE_SIGNED_RECEIPT"
                })
                .ok_or("MISSING_PAYMENT: receipt not established")?
                .clone();
            compatible(&payment.amount, amount)?;
            let o = state
                .obligations
                .get_mut(&payment.obligation_id)
                .ok_or("MISSING_OBLIGATION: reversal obligation absent")?;
            rights::revoke(o, payment_certificate_id, &proposal.allocations, amount)?;
            state.payments.push(PaymentObservation {
                certificate_id: id.into(),
                obligation_id: o.id.clone(),
                amount: amount.clone(),
                kind: "ALL_PARTY_RECONCILIATION".into(),
                discharged_amount: "0".into(),
                excess_amount: "0".into(),
                reference: reason.clone(),
            });
            affected.push(o.id.clone());
            proofs.push(payment_certificate_id.clone());
            explanation = "All parties authorized this bounded reconciliation; an attributed reversal claim alone cannot restore a debt.";
        }
        Action::ActivateProtectionService { commitment_id } => {
            let Assurance::Service {
                id: aid,
                prerequisites,
                fee,
                ..
            } = &a.assurance
            else {
                return Err("ASSURANCE_DISABLED: no enabled service commitment".into());
            };
            ensure(
                aid == commitment_id && prerequisites.is_empty(),
                "ASSURANCE_PRECONDITION",
                "service prerequisites unsupported or unmet",
            )?;
            state.active_services.insert((digest(a)?, aid.clone()));
            if let Some(fee) = fee {
                let oid = format!("protection:{}", fee.fee_id);
                let new_fee = !state.obligations.contains_key(&oid);
                establish(
                    state,
                    &oid,
                    &fee.amount,
                    fee.payer,
                    fee.provider,
                    "PROTECTION_FEE",
                    a,
                    id,
                    root_hash,
                )?;
                if let Some(o) = state.obligations.get_mut(&oid).filter(|_| new_fee) {
                    o.due_conditions = fee.due_conditions.clone();
                }
                affected.push(oid);
            }
            explanation = "All parties activated the explicit nonfinancial service undertaking. Any protection fee is separate from Operator compensation; performance and solvency are not certified.";
        }
        Action::AmendAgreement { .. } => {
            return Err("INTERNAL_BOUNDARY: amendments handled by the all-party chain".into());
        }
    }
    proofs.sort();
    proofs.dedup();
    state.effects.push(EffectAudit {
        certificate_id: id.into(),
        rule_id: rule,
        authorizers,
        proof_references: proofs,
        obligation_ids: affected,
        explanation: explanation.into(),
    });
    Ok(())
}

type AuthorizedActions = BTreeMap<String, (ActionCertificate, Vec<Role>)>;
type Ancestry = BTreeMap<String, BTreeSet<String>>;
type EffectProofs = BTreeMap<String, Vec<Obligation>>;

fn establishment_id(proposal: &ActionProposal, agreement: &AssignmentContract) -> Option<String> {
    match &proposal.action {
        Action::AcknowledgeCompletion { milestone_id, .. } => {
            Some(format!("milestone:{milestone_id}"))
        }
        Action::InvokeArtifactRule { rule_id, .. } => agreement
            .policy
            .artifact_rules
            .iter()
            .find(|rule| &rule.id == rule_id)
            .map(|rule| format!("milestone:{}", rule.milestone_id)),
        Action::ActivateProtectionService { .. } => match &agreement.assurance {
            Assurance::Service { fee: Some(fee), .. } => Some(format!("protection:{}", fee.fee_id)),
            _ => None,
        },
        _ => None,
    }
}

/// The closed action vocabulary defines financial dependencies. Knowledge edges
/// never enter this relation merely because they are authenticated ancestors.
/// Missing required witnesses still fail in apply; optional context cannot veto
/// an independently supported effect.
fn required_effects(
    proposal: &ActionProposal,
    knowledge: &BTreeSet<String>,
    valid: &AuthorizedActions,
    proofs: &EffectProofs,
    dependencies: &Ancestry,
    agreements: &BTreeMap<String, AssignmentContract>,
    conditional: &BTreeMap<String, UnresolvedRight>,
) -> BTreeSet<String> {
    let mut direct = BTreeSet::new();
    match &proposal.action {
        Action::AuthorizeExpense {
            category,
            expense_id,
            ..
        } => {
            // Caps consume authorized principal, never the remaining balance.
            // Other categories and receipts/releases are not cap prerequisites.
            for id in knowledge {
                if let Some((cert, _)) = valid.get(id)
                    && let Action::AuthorizeExpense {
                        category: prior,
                        expense_id: prior_id,
                        ..
                    } = &cert.proposal.action
                    && (prior == category || prior_id == expense_id)
                {
                    direct.insert(id.clone());
                }
            }
        }
        Action::PaymentReceipt { obligation_id, .. } => {
            for id in &proposal.parent_certificate_ids {
                if valid.contains_key(id)
                    && proofs.get(id).is_some_and(|items| {
                        items
                            .iter()
                            .any(|o| &o.id == obligation_id && o.certificate_ids.contains(id))
                    })
                {
                    direct.insert(id.clone());
                }
            }
        }
        Action::BilateralSettlement { releases, .. } => {
            for id in &proposal.parent_certificate_ids {
                if valid.contains_key(id)
                    && proofs.get(id).is_some_and(|items| {
                        items.iter().any(|o| {
                            releases.iter().any(|r| r.obligation_id == o.id)
                                && o.certificate_ids.contains(id)
                        })
                    })
                {
                    direct.insert(id.clone());
                }
            }
        }
        Action::ReconcileReversal {
            payment_certificate_id,
            ..
        } => {
            if valid
                .get(payment_certificate_id)
                .is_some_and(|(c, _)| matches!(c.proposal.action, Action::PaymentReceipt { .. }))
            {
                direct.insert(payment_certificate_id.clone());
            }
        }
        // No financial ledger is a prerequisite for these effects. When the
        // exact same stable obligation already accrued in known history, retain
        // only its establishment witnesses to preserve original due terms.
        // Each such witness has its own finite proof, never its arbitrary context.
        Action::AcknowledgeCompletion { .. }
        | Action::InvokeArtifactRule { .. }
        | Action::ActivateProtectionService { .. } => {
            if let Some(obligation) =
                establishment_id(proposal, &agreements[&proposal.agreement_hash])
            {
                for id in knowledge {
                    if let Some((cert, _)) = valid.get(id)
                        && !conditional.contains_key(id)
                        && establishment_id(
                            &cert.proposal,
                            &agreements[&cert.proposal.agreement_hash],
                        )
                        .as_ref()
                            == Some(&obligation)
                    {
                        direct.insert(id.clone());
                    }
                }
            }
        }
        Action::AmendAgreement { .. } => {}
    }
    let mut included = direct.clone();
    for id in direct {
        if let Some(required) = dependencies.get(&id) {
            included.extend(required.iter().cloned());
        }
    }
    included
}

struct ReductionContext<'a> {
    agreements: &'a BTreeMap<String, AssignmentContract>,
    events: &'a BTreeMap<String, SignedEvent>,
    attachments: &'a evidence::AttachmentIndex,
    root_hash: &'a str,
}
impl ReductionContext<'_> {
    fn apply(
        &self,
        state: &mut State,
        id: &str,
        cert: &ActionCertificate,
        roles: &[Role],
    ) -> Result<(), String> {
        apply(
            state,
            &cert.proposal,
            id,
            &self.agreements[&cert.proposal.agreement_hash],
            self,
            roles.to_vec(),
        )
    }
    fn required_state(
        &self,
        order: &[String],
        valid: &AuthorizedActions,
        included: &BTreeSet<String>,
    ) -> Result<State, String> {
        let mut state = State::default();
        for id in order.iter().filter(|id| included.contains(*id)) {
            let (cert, roles) = &valid[id];
            self.apply(&mut state, id, cert, roles)?;
        }
        Ok(state)
    }
}

/// Competing expense authorizations may exceed a jointly authorized cap.
/// Irrevocable grants are deliberately absent: contradictions cannot revoke them.
fn financial_conflicts(
    valid: &AuthorizedActions,
    ancestry: &Ancestry,
    proofs: &EffectProofs,
    context: &ReductionContext<'_>,
) -> BTreeSet<String> {
    let mut groups: BTreeMap<String, Vec<(String, String, u64, u64)>> = BTreeMap::new();
    type Establishment = (String, Money, Role, Role, Option<String>);
    let mut establishments: BTreeMap<String, Vec<Establishment>> = BTreeMap::new();
    for (id, (cert, _)) in valid {
        let a = &context.agreements[&cert.proposal.agreement_hash];
        // Use the finite proof already admitted, never replay causal context to
        // rediscover whether an independently established right exists.
        if matches!(
            cert.proposal.action,
            Action::AcknowledgeCompletion { .. }
                | Action::InvokeArtifactRule { .. }
                | Action::AuthorizeExpense { .. }
                | Action::ActivateProtectionService { .. }
        ) {
            for obligation in &proofs[id] {
                establishments
                    .entry(obligation.id.clone())
                    .or_default()
                    .push((
                        id.clone(),
                        obligation.amount.clone(),
                        obligation.debtor,
                        obligation.creditor,
                        match &cert.proposal.action {
                            Action::AuthorizeExpense { category, .. } => Some(category.clone()),
                            _ => None,
                        },
                    ));
            }
        }
        if let Action::AuthorizeExpense {
            expense_id,
            category,
            amount,
            ..
        } = &cert.proposal.action
            && let Some(cap) = a
                .quote
                .quote
                .expenses
                .iter()
                .find(|e| &e.category == category)
        {
            groups.entry(category.clone()).or_default().push((
                id.clone(),
                expense_id.clone(),
                amount.validate().unwrap_or(0),
                cap.cap.validate().unwrap_or(0),
            ));
        }
    }
    let mut conflicts = BTreeSet::new();
    for claims in establishments.values() {
        for (index, left) in claims.iter().enumerate() {
            for right in &claims[index + 1..] {
                let unordered =
                    !ancestry[&left.0].contains(&right.0) && !ancestry[&right.0].contains(&left.0);
                if unordered
                    && (left.1 != right.1
                        || left.2 != right.2
                        || left.3 != right.3
                        || left.4 != right.4)
                {
                    conflicts.insert(left.0.clone());
                    conflicts.insert(right.0.clone());
                }
            }
        }
    }
    for (category, group) in groups {
        let mut remaining: BTreeSet<_> = (0..group.len()).collect();
        while let Some(first) = remaining.pop_first() {
            let mut component = vec![first];
            let mut cursor = 0;
            while cursor < component.len() {
                let current = component[cursor];
                let neighbors: Vec<_> = remaining
                    .iter()
                    .copied()
                    .filter(|i| {
                        !ancestry[&group[current].0].contains(&group[*i].0)
                            && !ancestry[&group[*i].0].contains(&group[current].0)
                    })
                    .collect();
                for i in neighbors {
                    remaining.remove(&i);
                    component.push(i);
                }
                cursor += 1;
            }
            if component.len() < 2 {
                continue;
            }
            let mut common = ancestry[&group[first].0].clone();
            for i in &component {
                common.retain(|id| ancestry[&group[*i].0].contains(id));
            }
            // Count compatible expense identities once, including only the
            // same-category common principal. Never infer cap from paid balance
            // or select a hash winner among contradictory amounts.
            let mut principal = BTreeMap::new();
            let mut compatible = true;
            for id in &common {
                if let Some((cert, _)) = valid.get(id)
                    && let Action::AuthorizeExpense {
                        expense_id,
                        category: prior,
                        amount,
                        ..
                    } = &cert.proposal.action
                    && prior == &category
                {
                    let amount = amount.validate().expect("admitted expense amount");
                    if principal
                        .insert(expense_id.clone(), amount)
                        .is_some_and(|previous| previous != amount)
                    {
                        compatible = false;
                    }
                }
            }
            for i in &component {
                if principal
                    .insert(group[*i].1.clone(), group[*i].2)
                    .is_some_and(|previous| previous != group[*i].2)
                {
                    compatible = false;
                }
            }
            let total = principal
                .values()
                .try_fold(0u64, |n, amount| n.checked_add(*amount));
            let cap = component.iter().map(|i| group[*i].3).min();
            if !compatible || !matches!((total, cap), (Some(n), Some(cap)) if n <= cap) {
                conflicts.extend(component.into_iter().map(|i| group[i].0.clone()));
            }
        }
    }
    conflicts
}

pub fn verify_assignment_bundle(
    bundle: &AssignmentBundle,
    trust: &TrustConfiguration,
) -> Result<BundleReport, String> {
    if bundle.protocol_version == "1" {
        return crate::legacy::inspect(bundle, trust);
    }
    derive_report(bundle, trust, None)
}

/// The optional candidate is a private, unsigned preflight simulation. It is
/// never exposed by the public verifier or export API and cannot emit a signed
/// certificate. The signer uses only its admission result before authorization.
fn derive_report(
    bundle: &AssignmentBundle,
    trust: &TrustConfiguration,
    unsigned_candidate: Option<&ActionProposal>,
) -> Result<BundleReport, String> {
    ensure(
        bundle.protocol_version == PROTOCOL_VERSION
            && bundle.deployment_domain == trust.deployment_domain,
        "BUNDLE_DOMAIN",
        "unsupported version/deployment",
    )?;
    ensure(
        canonical(bundle)?.len() <= 4 * 1024 * 1024
            && bundle.actions.len() <= 1000
            && bundle.events.len() <= 1000
            && bundle.requests.len() <= 64
            && bundle.attachments.len() <= 128,
        "BUNDLE_BOUNDS",
        "bundle exceeds profile limits",
    )?;
    contract::validate_trust(trust)?;
    let result = contract::verify_contract(&bundle.agreement, &bundle.requests, trust);
    let root = &bundle.agreement.agreement;
    let mut errors = result.diagnostics.clone();
    let mut status = BTreeMap::new();
    let (map, current, amendments) = if result.bound {
        contracts(bundle, trust, &mut errors, &mut status)?
    } else {
        (
            BTreeMap::from([(result.agreement_hash.clone(), root.clone())]),
            result.agreement_hash.clone(),
            BTreeSet::new(),
        )
    };
    let context = EventContext {
        deployment_domain: trust.deployment_domain.clone(),
        assignment_id: root.assignment_id.clone(),
        agreement_hash: result.agreement_hash.clone(),
        keys: trust.parties.iter().map(|p| p.key.clone()).collect(),
    };
    let versioned_events: Vec<_> = bundle
        .events
        .iter()
        .filter(|e| e.envelope.protocol_version == PROTOCOL_VERSION)
        .cloned()
        .collect();
    for e in bundle
        .events
        .iter()
        .filter(|e| e.envelope.protocol_version != PROTOCOL_VERSION)
    {
        error(
            &digest(&e.envelope)?,
            "EVENT_VERSION: event version differs from its Agreement",
            &mut errors,
        );
    }
    let transcript = transcript::verify_events_for_contracts(
        &versioned_events,
        &context,
        &map.keys().cloned().collect(),
    );
    let attachments = evidence::index_attachments(&bundle.attachments);
    errors.extend(attachments.diagnostics.clone());
    let evidence_integrity = evidence::event_reports(&bundle.events, &transcript, &attachments);
    for report in &evidence_integrity {
        errors.extend(report.manifest.diagnostics.clone());
    }
    let mut state = State::default();
    let all = action_map(bundle)?;
    let causal_graph = crate::cutover::graph(&map, &all, &transcript.proof_events, &amendments);
    for (id, c) in &all {
        if let Some(a) = map.get(&c.proposal.agreement_hash) {
            for signature in &c.authorizations {
                let verification = a
                    .parties
                    .iter()
                    .find(|p| p.role.code() == signature.claims.role)
                    .ok_or_else(|| "KEY_AUTHORITY: unknown authorizing role".to_string())
                    .and_then(|p| {
                        crate::crypto::verify(
                            signature,
                            &contract::claims(
                                &a.deployment_domain,
                                &a.assignment_id,
                                id,
                                p,
                                "ACTION",
                            ),
                            &p.key,
                        )
                    });
                if let Err(e) = verification {
                    error(id, &e, &mut errors);
                }
            }
        }
    }
    let mut pending = BTreeMap::new();
    let mut slots: BTreeMap<(String, String, String), Vec<String>> = BTreeMap::new();
    if result.bound {
        for (id, c) in &all {
            if matches!(c.proposal.action, Action::AmendAgreement { .. }) {
                if !status.contains_key(id) {
                    status.insert(id.clone(), "PENDING".into());
                    error(
                        id,
                        "MISSING_DEPENDENCY: amendment parent missing or conflicted",
                        &mut errors,
                    );
                }
                continue;
            }
            let Some(a) = map.get(&c.proposal.agreement_hash) else {
                status.insert(id.clone(), "PENDING".into());
                error(
                    id,
                    "UNKNOWN_AGREEMENT: missing or conflicted revision",
                    &mut errors,
                );
                continue;
            };
            match actions::validate_authorizations(c, a) {
                Ok(roles) => {
                    if actions::exclusive(&c.proposal.action) {
                        slots
                            .entry((
                                root.assignment_id.clone(),
                                c.proposal.scope_id.clone(),
                                c.proposal.scope_version.clone(),
                            ))
                            .or_default()
                            .push(id.clone());
                    }
                    pending.insert(id.clone(), (c.clone(), roles));
                }
                Err(e) => {
                    status.insert(id.clone(), "REJECTED".into());
                    error(id, &e, &mut errors);
                }
            }
        }
    } else {
        for id in all.keys() {
            status.insert(id.clone(), "UNBOUND".into());
        }
    }
    if let Some(proposal) = unsigned_candidate {
        ensure(
            result.bound,
            "AGREEMENT_UNBOUND",
            "preflight needs the actual complete root certificate",
        )?;
        let a = map
            .get(&proposal.agreement_hash)
            .ok_or("UNKNOWN_AGREEMENT: preflight revision missing")?;
        actions::validate_proposal(proposal, a)?;
        ensure(
            !matches!(proposal.action, Action::AmendAgreement { .. }),
            "PREFLIGHT_SCOPE",
            "root amendment uses separate all-party validation",
        )?;
        let id = digest(proposal)?;
        if actions::exclusive(&proposal.action) {
            let slot = slots
                .entry((
                    root.assignment_id.clone(),
                    proposal.scope_id.clone(),
                    proposal.scope_version.clone(),
                ))
                .or_default();
            if !slot.contains(&id) {
                slot.push(id.clone());
            }
        }
        pending.insert(
            id,
            (
                ActionCertificate {
                    proposal: proposal.clone(),
                    authorizations: vec![],
                },
                actions::required_authorizers(&proposal.action),
            ),
        );
    }
    let context = ReductionContext {
        agreements: &map,
        events: &transcript.proof_events,
        attachments: &attachments,
        root_hash: &result.agreement_hash,
    };
    let mut validated = AuthorizedActions::new();
    let mut validation_order = vec![];
    let mut ancestry = Ancestry::new();
    let mut dependencies = Ancestry::new();
    let mut proof_states = EffectProofs::new();
    let mut unresolved_rights: BTreeMap<String, UnresolvedRight> = BTreeMap::new();
    // Successor Contracts inherit the authenticated amendment frontier. This
    // is ordering/provenance, not permission for contextual claims to gate money.
    let causal_ancestry: Ancestry = pending
        .iter()
        .map(|(id, (cert, _))| {
            (
                id.clone(),
                crate::cutover::ancestors(
                    &crate::cutover::action_references(&cert.proposal),
                    &causal_graph,
                ),
            )
        })
        .collect();
    while !pending.is_empty() {
        let mut progressed = false;
        let mut ids: Vec<_> = pending.keys().cloned().collect();
        ids.sort_by_key(|id| {
            let a = &map[&pending[id].0.proposal.agreement_hash];
            (parse_minor_units(&a.revision).unwrap_or(0), id.clone())
        });
        for id in ids {
            let (c, roles) = &pending[&id];
            let ancestors = causal_ancestry[&id].clone();
            if ancestors.iter().any(|parent| pending.contains_key(parent)) {
                continue;
            }
            let required = required_effects(
                &c.proposal,
                &ancestors,
                &validated,
                &proof_states,
                &dependencies,
                &map,
                &unresolved_rights,
            );
            let validation = context
                .required_state(&validation_order, &validated, &required)
                .and_then(|mut candidate| {
                    context.apply(&mut candidate, &id, c, roles)?;
                    let targets = &candidate
                        .effects
                        .last()
                        .ok_or("INTERNAL_EFFECT: no candidate effect")?
                        .obligation_ids;
                    let rights: Vec<_> = targets
                        .iter()
                        .filter_map(|id| candidate.obligations.get(id).cloned())
                        .collect();
                    proof_states.insert(id.clone(), rights.clone());
                    match crate::cutover::fresh_effect(
                        &c.proposal,
                        &id,
                        &causal_graph,
                        &all,
                        &amendments,
                    ) {
                        Err(e) if e.starts_with("CUTOVER_UNRESOLVED") => {
                            unresolved_rights.insert(
                                id.clone(),
                                UnresolvedRight {
                                    certificate_id: id.clone(),
                                    reason: e.clone(),
                                    obligations: rights,
                                },
                            );
                            error(&id, &e, &mut errors);
                            Ok(())
                        }
                        result => result,
                    }
                });
            match validation {
                Ok(()) => {
                    validated.insert(id.clone(), (c.clone(), roles.clone()));
                    validation_order.push(id.clone());
                    ancestry.insert(id.clone(), ancestors);
                    dependencies.insert(id.clone(), required);
                    pending.remove(&id);
                    progressed = true;
                }
                Err(e) if e.starts_with("MISSING_") => {}
                Err(e) => {
                    status.insert(id.clone(), "REJECTED".into());
                    error(&id, &e, &mut errors);
                    pending.remove(&id);
                    progressed = true;
                }
            }
        }
        if !progressed {
            // An authenticated contextual record can remain semantically pending
            // (e.g. a receipt for no obligation). Classify it, then allow unrelated
            // successor effects to validate; do not give it a financial veto.
            let unresolved: Vec<_> = pending
                .keys()
                .filter(|id| {
                    !causal_ancestry[*id]
                        .iter()
                        .any(|parent| pending.contains_key(parent))
                })
                .cloned()
                .collect();
            if unresolved.is_empty() {
                break;
            }
            for id in unresolved {
                pending.remove(&id);
                status.insert(id.clone(), "PENDING".into());
                error(
                    &id,
                    "MISSING_DEPENDENCY: authenticated context lacks an applicable obligation or complete direct proof",
                    &mut errors,
                );
            }
        }
    }
    for (id, _) in pending {
        status.insert(id.clone(), "PENDING".into());
        error(
            &id,
            "MISSING_DEPENDENCY: action or proof dependencies absent, rejected or conflicted",
            &mut errors,
        );
    }
    // Semantic admission and actual-creditor checks precede misconduct grouping.
    // Slot collisions never revoke the independent grants carried by receipts.
    for ids in slots.values() {
        let admitted: Vec<_> = ids
            .iter()
            .filter(|id| validated.contains_key(*id))
            .collect();
        if admitted.len() > 1 {
            for id in admitted {
                error(
                    id,
                    "EXCLUSIVE_CONFLICT: multiple semantically valid signed records reuse a bookkeeping slot; independent grants remain effective",
                    &mut errors,
                );
            }
        }
    }
    let conflicts = financial_conflicts(&validated, &ancestry, &proof_states, &context);
    for id in &conflicts {
        status.insert(id.clone(), "CONFLICTED".into());
        unresolved_rights.insert(id.clone(), UnresolvedRight{certificate_id:id.clone(), reason:"BALANCE_CONFLICT: joint expense applicability is unresolved; preserve this individually validated financial proof".into(), obligations:proof_states[id].clone()});
        error(
            id,
            "BALANCE_CONFLICT: jointly authorized expense claims disagree on entitlement or exceed a common cap; no arrival/hash/dependency-depth winner is selected",
            &mut errors,
        );
    }
    for id in validation_order {
        let (cert, roles) = &validated[&id];
        if conflicts.contains(&id) {
            continue;
        }
        if unresolved_rights.contains_key(&id) {
            status.insert(id, "UNRESOLVED".into());
            continue;
        }
        // Causal references attest knowledge. Only the effect's exact financial
        // basis/proof requirements can gate its grant, not an unrelated ancestor.
        let mut candidate = state.clone();
        match context.apply(&mut candidate, &id, cert, roles) {
            Ok(()) => {
                // Export the finite financial witness closure separately from
                // arbitrary causal context so an inspector can audit the basis.
                if let Some(effect) = candidate.effects.last_mut() {
                    effect
                        .proof_references
                        .extend(dependencies[&id].iter().cloned());
                    effect.proof_references.sort();
                    effect.proof_references.dedup();
                }
                state = candidate;
                status.insert(id, "APPLIED".into());
            }
            Err(e) => {
                // The exact causal proof was valid. A competing/ambiguous
                // projection cannot erase it or turn its protected credit to zero.
                status.insert(id.clone(), "UNRESOLVED".into());
                unresolved_rights.insert(
                    id.clone(),
                    UnresolvedRight {
                        certificate_id: id.clone(),
                        reason: e.clone(),
                        obligations: proof_states[&id].clone(),
                    },
                );
                error(&id, &e, &mut errors);
            }
        }
    }
    for id in amendments {
        state.effects.push(EffectAudit{certificate_id:id,rule_id:"ALL_PARTY_AMENDMENT".into(),authorizers:vec![Role::Requester,Role::Operator,Role::Mediator],proof_references:vec![],obligation_ids:vec![],explanation:"Prospective all-party Agreement revision; established receivables and disputed claims are retained.".into()});
    }
    for o in state.obligations.values() {
        let overlap = o.credit_grants.iter().enumerate().any(|(i, left)| {
            o.credit_grants.iter().skip(i + 1).any(|right| {
                left.allocations.iter().any(|a| {
                    right.allocations.iter().any(|b| {
                        parse_minor_units(&a.start).unwrap_or(0)
                            < parse_minor_units(&b.end).unwrap_or(0)
                            && parse_minor_units(&b.start).unwrap_or(0)
                                < parse_minor_units(&a.end).unwrap_or(0)
                    })
                })
            })
        });
        if overlap {
            error(
                &o.id,
                "CREDIT_OVERLAP: distinct signed receipts grant overlapping debt units; union counts each unit once and makes no inference about distinct bank transfers or refunds",
                &mut errors,
            );
        }
        if o.overlap_amount != "0" {
            error(
                &o.id,
                "RELEASE_PAYMENT_OVERLAP: payment and release grants overlap; both protections remain recognized and shared units count once",
                &mut errors,
            );
        }
    }
    let mut unresolved = vec![];
    let mut started = false;
    let mut completion_claimed = false;
    let mut performance_disputed = false;
    for (id, e) in &transcript.accepted {
        match &e.envelope.body {
            EventBody::StartClaim => started = true,
            EventBody::CompletionClaim { .. } => completion_claimed = true,
            EventBody::DisputeOpened { subject_id, .. } => {
                unresolved.push(id.clone());
                performance_disputed |=
                    root.quote.quote.milestones.iter().any(|m| {
                        subject_id == &m.id || subject_id == &format!("milestone:{}", m.id)
                    });
                if let Some(o) = state.obligations.get_mut(subject_id) {
                    o.disputed_amount = o.unresolved_balance.clone();
                }
            }
            EventBody::RejectionClaim {
                completion_hash, ..
            } => {
                unresolved.push(id.clone());
                performance_disputed = true;
                if let Some(e) = transcript.accepted.get(completion_hash)
                    && let EventBody::CompletionClaim { milestone_id, .. } = &e.envelope.body
                    && let Some(o) = state
                        .obligations
                        .get_mut(&format!("milestone:{milestone_id}"))
                {
                    o.disputed_amount = o.unresolved_balance.clone();
                }
            }
            EventBody::Recommendation { .. }
            | EventBody::AssuranceClaim { .. }
            | EventBody::AssuranceAssessment { .. }
            | EventBody::CancellationNotice { .. }
            | EventBody::PaymentReversalClaim { .. } => unresolved.push(id.clone()),
            EventBody::PayerStatement {
                obligation_id,
                amount,
                reference,
            }
            | EventBody::MediatorPaymentObservation {
                obligation_id,
                amount,
                reference,
            } => state.payments.push(PaymentObservation {
                certificate_id: id.clone(),
                obligation_id: obligation_id.clone(),
                amount: amount.clone(),
                kind: if matches!(e.envelope.body, EventBody::PayerStatement { .. }) {
                    "PAYER_STATEMENT"
                } else {
                    "MEDIATOR_OBSERVATION"
                }
                .into(),
                discharged_amount: "0".into(),
                excess_amount: "0".into(),
                reference: reference.clone(),
            }),
            _ => {}
        }
    }
    unresolved.extend(
        errors
            .iter()
            .filter(|e| {
                matches!(
                    e.code.as_str(),
                    "ENTITLEMENT_CONFLICT"
                        | "BALANCE_CONFLICT"
                        | "EXCLUSIVE_CONFLICT"
                        | "CUTOVER_UNRESOLVED"
                )
            })
            .map(|e| e.subject.clone()),
    );
    let current_a = &map[&current];
    let mut readiness = vec![];
    let assurance_active = match &current_a.assurance {
        Assurance::Service { id, .. } => state
            .active_services
            .contains(&(current.clone(), id.clone())),
        _ => false,
    };
    if !result.bound {
        readiness.push("Complete independently verified R/O/M certificate not retained".into());
    }
    if !current_a.payments.preconditions.is_empty() {
        readiness
            .push("Payment preconditions have no supported proof adapter in this profile".into());
    }
    if matches!(current_a.assurance, Assurance::Service { .. }) && !assurance_active {
        readiness.push("Protection service is not activated with verified prerequisites".into());
    }
    if status.values().any(|s| s == "CONFLICTED") {
        readiness.push(
            "Affected contractual scope is conflicted; inspect the retained certificates".into(),
        );
    }
    if status.values().any(|s| s == "UNRESOLVED") {
        readiness.push("Cutover order of prior-policy claims is unresolved; no fresh retired power is inferred".into());
    }
    let accepted = current_a.quote.quote.milestones.iter().all(|m| {
        state
            .obligations
            .contains_key(&format!("milestone:{}", m.id))
    });
    let performance = if performance_disputed {
        "DISPUTED"
    } else if accepted {
        "ACCEPTED"
    } else if completion_claimed {
        "COMPLETION_CLAIMED"
    } else if started {
        "START_CLAIMED"
    } else {
        "NOT_STARTED"
    }
    .into();
    Ok(BundleReport{financial_projection:if status.values().any(|s|s=="UNRESOLVED" || s=="CONFLICTED") {"PARTIAL_UNRESOLVED_V2"} else {"UNIT_GRANTS_V2"}.into(),recognized_legacy_proofs:vec![],unresolved_rights:unresolved_rights.into_values().collect(),evidence_integrity,agreement:result,current_agreement_hash:current,ready_to_start:readiness.is_empty(),readiness_reasons:readiness,performance,
        mediation:if unresolved.is_empty(){"NO_OPEN_CASE"}else{"UNRESOLVED"}.into(),assurance:if assurance_active{"SERVICE_UNDERTAKING_ACTIVE"}else if matches!(current_a.assurance,Assurance::Disabled{..}){"DISABLED"}else{"NOT_ACTIVE"}.into(),
        obligations:state.obligations.into_values().collect(),effects:state.effects,payments:state.payments,diagnostics:errors,action_status:status,transcript,unresolved_claims:unresolved,
        history_completeness:"UNKNOWN: this report describes only the supplied local view; omitted records may exist".into(),assumptions:vec!["Role-key bindings supplied independently; excluded participant's key and verifier uncompromised".into(),"No hardware/distribution trust claim is supplied by this package".into(),"Payee receipts are attributed acknowledgments, not independently observed or irreversible bank settlement".into(),"Physical truth, solvency, timely delivery, hidden transcript branches and universal dispute resolution are not established".into()]})
}

/// Pre-signing checks cannot authorize an effect. They expose the same semantic
/// checks using an already verified local projection, without synthesizing signatures.
pub fn validate_unsigned_action(
    proposal: &ActionProposal,
    bundle: &AssignmentBundle,
    trust: &TrustConfiguration,
) -> Result<(), String> {
    let report = verify_assignment_bundle(bundle, trust)?;
    let a = known_contract(bundle, &proposal.agreement_hash, trust)?;
    actions::validate_proposal(proposal, &a)?;
    if report
        .action_status
        .get(&digest(proposal)?)
        .map(String::as_str)
        == Some("APPLIED")
    {
        return Ok(());
    }
    if let Action::AmendAgreement { .. } = &proposal.action {
        let (known_agreements, _, amendment_ids) =
            contracts(bundle, trust, &mut vec![], &mut BTreeMap::new())?;
        crate::cutover::validate_amendment(
            proposal,
            &a,
            bundle,
            trust,
            &known_agreements,
            &amendment_ids,
        )?;
        ensure(
            proposal.agreement_hash == report.current_agreement_hash,
            "AMENDMENT_PARENT",
            "local signer must extend its latest verified Agreement",
        )?;
        return Ok(());
    }
    let simulated = derive_report(bundle, trust, Some(proposal))?;
    let id = digest(proposal)?;
    ensure(
        simulated.action_status.get(&id).map(String::as_str) == Some("APPLIED"),
        "PREFLIGHT_REJECTED",
        "candidate is incomplete, rejected or conflicts under the same causal rules as final admission",
    )
}

/// Compatibility entry point for the prior API vocabulary.
pub use known_contract as known_agreement;
