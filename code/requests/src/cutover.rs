// SPDX-License-Identifier: AGPL-3.0-only
//! Prospective policy authority is distinct from historical authentication.
use crate::{
    actions,
    agreement::{self, ensure},
    encoding::digest,
    model::*,
    money::parse_minor_units,
    transcript::{self, EventBody, EventContext, SignedEvent},
};
use std::collections::{BTreeMap, BTreeSet};

pub(crate) fn action_references(p: &ActionProposal) -> Vec<String> {
    let mut refs = p.parent_certificate_ids.clone();
    match &p.action {
        Action::AcknowledgeCompletion {
            completion_event_hash,
            ..
        }
        | Action::InvokeArtifactRule {
            completion_event_hash,
            ..
        } => refs.push(completion_event_hash.clone()),
        Action::AuthorizeExpense {
            evidence_event_hash,
            ..
        } => refs.push(evidence_event_hash.clone()),
        Action::ReconcileReversal {
            payment_certificate_id,
            ..
        } => refs.push(payment_certificate_id.clone()),
        _ => {}
    }
    refs
}
fn event_references(e: &SignedEvent) -> Vec<String> {
    let mut refs = e.envelope.causal_references.clone();
    refs.extend(e.envelope.previous_event_hash.clone());
    refs.push(e.envelope.agreement_hash.clone());
    if let EventBody::RejectionClaim {
        completion_hash, ..
    } = &e.envelope.body
    {
        refs.push(completion_hash.clone());
    }
    refs
}
type Graph = BTreeMap<String, Vec<String>>;
pub(crate) fn graph(
    map: &BTreeMap<String, AssignmentAgreement>,
    actions: &BTreeMap<String, ActionCertificate>,
    events: &BTreeMap<String, SignedEvent>,
    amendments: &BTreeSet<String>,
) -> Graph {
    let mut graph: Graph = map.keys().map(|id| (id.clone(), vec![])).collect();
    for (id, e) in events {
        graph.insert(id.clone(), event_references(e));
    }
    for (id, c) in actions {
        if let Some(a) = map.get(&c.proposal.agreement_hash)
            && actions::validate_proposal(&c.proposal, a).is_ok()
            && agreement::verify_role_signatures(&c.authorizations, a, id, "ACTION")
                .is_ok_and(|roles| !roles.is_empty())
        {
            // Knowledge is attributed once a pinned party signs this exact
            // valid proposal. Completing its financial authorization later
            // must not introduce previously hidden knowledge edges. Effect
            // admission separately requires every action-specific authorizer.
            graph.insert(id.clone(), action_references(&c.proposal));
            // A partial amendment is only an attributed proposal. It cannot
            // introduce a successor Agreement or change active authority.
            if amendments.contains(id)
                && let Action::AmendAgreement { replacement } = &c.proposal.action
            {
                graph.insert(digest(replacement).unwrap_or_default(), vec![id.clone()]);
            }
        }
    }
    graph
}
pub(crate) fn ancestors(seeds: &[String], graph: &Graph) -> BTreeSet<String> {
    let mut found = BTreeSet::new();
    let mut todo = seeds.to_vec();
    while let Some(id) = todo.pop() {
        if found.insert(id.clone())
            && let Some(refs) = graph.get(&id)
        {
            todo.extend(refs.iter().cloned());
        }
    }
    found
}

/// Authenticate frontier references. This attests knowledge/order, never the
/// truth or applicability of a referenced claim. Its effect is validated later.
pub(crate) fn validate_amendment(
    p: &ActionProposal,
    a: &AssignmentAgreement,
    bundle: &AssignmentBundle,
    trust: &TrustConfiguration,
    map: &BTreeMap<String, AssignmentAgreement>,
    accepted: &BTreeSet<String>,
) -> Result<(), String> {
    actions::validate_proposal(p, a)?;
    let Action::AmendAgreement { replacement } = &p.action else {
        return Err("AMENDMENT_TYPE: amendment required".into());
    };
    agreement::validate_agreement(replacement, &bundle.requests, trust)?;
    ensure(
        replacement.assignment_id == a.assignment_id
            && replacement.request_id == a.request_id
            && replacement.previous_agreement_hash.as_deref() == Some(p.agreement_hash.as_str()),
        "AMENDMENT_PARENT",
        "retain assignment and exact previous Agreement",
    )?;
    ensure(
        parse_minor_units(&replacement.revision)? == parse_minor_units(&a.revision)? + 1,
        "AMENDMENT_VERSION",
        "revision increments exactly once",
    )?;
    ensure(
        replacement.parties == a.parties,
        "KEY_ROTATION_UNSUPPORTED",
        "role bindings remain pinned",
    )?;
    let old: BTreeMap<_, _> = a
        .quote
        .quote
        .milestones
        .iter()
        .map(|m| (&m.id, &m.compensation))
        .collect();
    let new: BTreeMap<_, _> = replacement
        .quote
        .quote
        .milestones
        .iter()
        .map(|m| (&m.id, &m.compensation))
        .collect();
    ensure(
        old == new,
        "AMENDMENT_WORK_UNITS",
        "policy 2 preserves existing milestone identities and unit principals; novation requires a future explicit policy",
    )?;
    for prior in map.values() {
        if let (
            Assurance::Service { fee: Some(old), .. },
            Assurance::Service { fee: Some(new), .. },
        ) = (&prior.assurance, &replacement.assurance)
            && old.fee_id == new.fee_id
        {
            ensure(
                old.amount == new.amount && old.payer == new.payer && old.provider == new.provider,
                "AMENDMENT_FEE_UNITS",
                "an existing fee identity retains its principal and parties",
            )?;
        }
    }
    let context = EventContext {
        deployment_domain: trust.deployment_domain.clone(),
        assignment_id: a.assignment_id.clone(),
        agreement_hash: digest(&bundle.agreement.agreement)?,
        keys: trust.parties.iter().map(|p| p.key.clone()).collect(),
    };
    let events: Vec<_> = bundle
        .events
        .iter()
        .filter(|e| e.envelope.protocol_version == PROTOCOL_VERSION)
        .cloned()
        .collect();
    let transcript =
        transcript::verify_events_for_agreements(&events, &context, &map.keys().cloned().collect());
    let mut certs = BTreeMap::<String, ActionCertificate>::new();
    for c in &bundle.actions {
        let id = digest(&c.proposal)?;
        certs
            .entry(id)
            .and_modify(|prior| {
                for sig in &c.authorizations {
                    if !prior.authorizations.contains(sig) {
                        prior.authorizations.push(sig.clone());
                    }
                }
            })
            .or_insert_with(|| c.clone());
    }
    let graph = graph(map, &certs, &transcript.proof_events, accepted);
    let refs = ancestors(&p.parent_certificate_ids, &graph);
    ensure(
        refs.iter().all(|id| graph.contains_key(id)),
        "MISSING_DEPENDENCY",
        "cutover frontier requires authenticated, available causal records",
    )?;
    ensure(
        !refs.contains(&digest(p)?) && !refs.contains(&digest(replacement)?),
        "CUTOVER_CYCLE",
        "frontier cannot depend on its own amendment or successor",
    )?;
    Ok(())
}

/// Old receipts/reconciliations discharge historical obligations. Fresh powers
/// need an active policy, a proved pre-cutover frontier, or an explicit grant.
pub(crate) fn fresh_effect(
    p: &ActionProposal,
    id: &str,
    graph: &Graph,
    actions: &BTreeMap<String, ActionCertificate>,
    amendments: &BTreeSet<String>,
) -> Result<(), String> {
    if matches!(
        p.action,
        Action::PaymentReceipt { .. }
            | Action::BilateralSettlement { .. }
            | Action::ReconcileReversal { .. }
    ) {
        return Ok(());
    }
    let knowledge = ancestors(&action_references(p), graph);
    for amendment_id in amendments {
        let c = &actions[amendment_id];
        if c.proposal.agreement_hash != p.agreement_hash {
            continue;
        }
        let cutover = c
            .proposal
            .cutover
            .as_ref()
            .ok_or("CUTOVER_REQUIRED: missing signed cutover")?;
        if cutover.grandfathered_actions.iter().any(|r| r == id) {
            continue;
        }
        let Action::AmendAgreement { replacement } = &c.proposal.action else {
            continue;
        };
        ensure(
            !knowledge.contains(amendment_id) && !knowledge.contains(&digest(replacement)?),
            "RETIRED_AUTHORITY",
            "causal context knows the successor; retired powers cannot create a fresh effect",
        )?;
        let frontier = ancestors(&cutover.frontier, graph);
        ensure(
            frontier.contains(id),
            "CUTOVER_UNRESOLVED",
            "old-policy claim has no authenticated pre-cutover ordering; preserve the claim without executing the retired power",
        )?;
    }
    Ok(())
}
