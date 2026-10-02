// SPDX-License-Identifier: AGPL-3.0-only
//! Unsigned, synthetic development drafts. Only the core verifier grants effects.
use nonverba_requests::{
    actions, agreement, bundle, crypto, encoding, evidence,
    model::*,
    money::{Money, parse_minor_units},
    transcript::{ArtifactRef, EventBody, EventEnvelope, EvidenceManifest, SignedEvent},
};
use serde::de::DeserializeOwned;
use std::collections::BTreeSet;

const TEMPLATE: &str = include_str!("../../../tests/fixtures/lifecycle-bundle.json");
const SYNTHETIC: &str =
    "SYNTHETIC DEVELOPMENT ONLY; no real payment or physical performance is asserted.";

fn template() -> Result<AssignmentBundle, String> {
    encoding::strict_parse(TEMPLATE.as_bytes())
}

fn unique_id(prefix: &str) -> Result<String, String> {
    let mut random = [0u8; 16];
    getrandom::getrandom(&mut random).map_err(|e| format!("DRAFT_RANDOM: {e}"))?;
    Ok(format!("{prefix}-{}", hex::encode(random)))
}

fn trusted(trust: &TrustConfiguration, role: Role) -> Result<PartyBinding, String> {
    agreement::validate_trust(trust)?;
    trust
        .parties
        .iter()
        .find(|party| party.role == role)
        .cloned()
        .ok_or_else(|| "DRAFT_TRUST: missing independently supplied role binding".into())
}

pub fn request(trust: &TrustConfiguration) -> Result<Request, String> {
    let mut request = template()?.requests.remove(0).request;
    request.protocol_version = PROTOCOL_VERSION.into();
    request.deployment_domain = trust.deployment_domain.clone();
    request.request_id = unique_id("synthetic-request")?;
    request.revision = "1".into();
    request.requester = trusted(trust, Role::Requester)?;
    request.service.description = format!("{SYNTHETIC} {}", request.service.description);
    // The unsigned consent field must be reviewed before the Request is signed.
    request.accepts_platform_terms = true;
    Ok(request)
}

pub fn quote(request: &SignedRequest, trust: &TrustConfiguration) -> Result<Quote, String> {
    let request_hash = agreement::verify_request(request, trust)?;
    let mut quote = template()?.agreement.agreement.quote.quote;
    quote.protocol_version = PROTOCOL_VERSION.into();
    quote.deployment_domain = trust.deployment_domain.clone();
    quote.quote_id = unique_id("synthetic-quote")?;
    quote.request_hash = request_hash;
    quote.service_hash = encoding::digest(&request.request.service)?;
    quote.accepted_terms_hash = encoding::digest(&request.request.terms)?;
    quote.operator = trusted(trust, Role::Operator)?;
    Ok(quote)
}

pub fn agreement(
    request: SignedRequest,
    quote: SignedQuote,
    trust: &TrustConfiguration,
) -> Result<AssignmentBundle, String> {
    agreement::verify_quote(&quote, &request, trust)?;
    if quote.quote.milestones.len() != 1 {
        return Err("DRAFT_PROFILE: the guided synthetic Agreement supports one milestone; review a separately constructed Agreement for other shapes".into());
    }
    let mut output = template()?;
    let a = &mut output.agreement.agreement;
    a.protocol_version = PROTOCOL_VERSION.into();
    a.schema_version = PROTOCOL_VERSION.into();
    a.deployment_domain = trust.deployment_domain.clone();
    a.assignment_id = unique_id("synthetic-assignment")?;
    a.request_id = request.request.request_id.clone();
    a.request_hash = encoding::digest(&request.request)?;
    a.revision = "1".into();
    a.previous_agreement_hash = None;
    a.parties = trust.parties.clone();
    a.service = request.request.service.clone();
    a.acceptance[0].milestone_id = quote.quote.milestones[0].id.clone();
    a.quote = quote;
    // Keep the exact terms consented to in the signed Request and Quote.
    a.legal.artifacts = request.request.terms.clone();
    a.legal.consent_text = format!("{SYNTHETIC} {}", a.legal.consent_text);
    a.payments.rail = "SYNTHETIC-NO-FUNDS".into();
    a.payments.destination = "SYNTHETIC-OPERATOR-NO-PAYMENT".into();
    a.policy_hash = encoding::digest(&a.policy)?;
    output.protocol_version = PROTOCOL_VERSION.into();
    output.deployment_domain = trust.deployment_domain.clone();
    output.requests = vec![request];
    output.agreement.signatures.clear();
    output.actions.clear();
    output.events.clear();
    output.attachments.clear();
    agreement::validate_agreement(a, &output.requests, trust)?;
    Ok(output)
}

/// Public synthetic bytes matching the generated completion manifest.
pub fn synthetic_attachment() -> Result<Attachment, String> {
    let attachment = template()?
        .attachments
        .into_iter()
        .next()
        .ok_or("DRAFT_TEMPLATE: missing public synthetic attachment")?;
    if !evidence::index_attachments(std::slice::from_ref(&attachment))
        .verified_bytes
        .contains_key(&attachment.sha256)
    {
        return Err("DRAFT_TEMPLATE: synthetic attachment integrity failed".into());
    }
    Ok(attachment)
}

fn current(
    input: &AssignmentBundle,
    trust: &TrustConfiguration,
) -> Result<(AssignmentAgreement, BundleReport), String> {
    let report = bundle::verify_assignment_bundle(input, trust)?;
    if !report.agreement.bound {
        return Err("DRAFT_UNBOUND: retain the exact independently signed R/O/M Agreement certificate before drafting events or actions".into());
    }
    let a = bundle::known_agreement(input, &report.current_agreement_hash, trust)?;
    Ok((a, report))
}

fn milestone(a: &AssignmentAgreement) -> Result<&Milestone, String> {
    if a.quote.quote.milestones.len() != 1 {
        return Err("DRAFT_PROFILE: the guided event needs exactly one milestone; use an explicit reviewed envelope otherwise".into());
    }
    Ok(&a.quote.quote.milestones[0])
}

fn obligation<'a>(report: &'a BundleReport, target: &str) -> Result<&'a Obligation, String> {
    report.obligations.iter().find(|o| o.id == target).ok_or_else(|| {
        "DRAFT_OBLIGATION: target is not an established obligation in the supplied verified history; conditional rights are not selected automatically".into()
    })
}

fn next_event(
    report: &BundleReport,
    role: Role,
    key_id: &str,
) -> Result<(String, Option<String>), String> {
    if report
        .transcript
        .conflicts
        .iter()
        .any(|c| c.author_role == role.code())
    {
        return Err("DRAFT_STREAM: own authenticated stream is conflicted; an automatic branch choice is unavailable".into());
    }
    let mut tip: Option<(u64, String)> = None;
    for (hash, event) in &report.transcript.retained_events {
        let e = &event.envelope;
        if e.author_role != role.code() || e.key_id != key_id || e.key_epoch != "1" {
            continue;
        }
        if !report.transcript.accepted.contains_key(hash) {
            return Err("DRAFT_STREAM: own authenticated event is not admitted; resolve its supplied-history gap before extending the stream".into());
        }
        let sequence = parse_minor_units(&e.sequence)?;
        if tip.as_ref().is_none_or(|(n, _)| sequence > *n) {
            tip = Some((sequence, hash.clone()));
        }
    }
    match tip {
        None => Ok(("0".into(), None)),
        Some((sequence, hash)) => {
            let next = sequence
                .checked_add(1)
                .ok_or("DRAFT_STREAM: sequence exhausted")?;
            parse_minor_units(&next.to_string())?;
            Ok((next.to_string(), Some(hash)))
        }
    }
}

pub fn event(
    kind: &str,
    input: &AssignmentBundle,
    trust: &TrustConfiguration,
) -> Result<EventEnvelope, String> {
    let (a, report) = current(input, trust)?;
    let work = milestone(&a)?;
    let (role, body) = match kind {
        "completion" => {
            let attachment = synthetic_attachment()?;
            let index = evidence::index_attachments(std::slice::from_ref(&attachment));
            let bytes = index
                .verified_bytes
                .get(&attachment.sha256)
                .ok_or("DRAFT_TEMPLATE: missing verified bytes")?;
            (
                Role::Operator,
                EventBody::CompletionClaim {
                    milestone_id: work.id.clone(),
                    manifest: EvidenceManifest {
                        artifacts: vec![ArtifactRef {
                            sha256: attachment.sha256,
                            byte_length: bytes.len().to_string(),
                            media_type: "text/plain".into(),
                            capture_reference: None,
                        }],
                        description: SYNTHETIC.into(),
                    },
                },
            )
        }
        "payer-observation" => {
            let debt = obligation(&report, &format!("milestone:{}", work.id))?;
            (
                Role::Requester,
                EventBody::PayerStatement {
                    obligation_id: debt.id.clone(),
                    amount: debt.amount.clone(),
                    reference: SYNTHETIC.into(),
                },
            )
        }
        "dispute" => (
            Role::Requester,
            EventBody::DisputeOpened {
                dispute_id: unique_id("synthetic-dispute")?,
                subject_id: format!("milestone:{}", work.id),
                reason: format!("{SYNTHETIC} Example disputed performance; no finding of fault."),
            },
        ),
        _ => {
            return Err(
                "DRAFT_KIND: event kind must be completion, payer-observation, or dispute".into(),
            );
        }
    };
    let party = agreement::party(&a, role)?;
    let (sequence, previous_event_hash) = next_event(&report, role, &party.key.key_id)?;
    Ok(EventEnvelope {
        protocol_version: PROTOCOL_VERSION.into(),
        deployment_domain: a.deployment_domain.clone(),
        assignment_id: a.assignment_id.clone(),
        agreement_hash: report.current_agreement_hash,
        author_role: role.code().into(),
        key_id: party.key.key_id.clone(),
        key_epoch: "1".into(),
        sequence,
        previous_event_hash,
        nonce: unique_id("synthetic-event")?,
        causal_references: vec![],
        claimed_creation_time: None,
        body,
    })
}

fn target(value: Option<&str>) -> Result<&str, String> {
    value.ok_or_else(|| "DRAFT_TARGET: this action requires an explicit exact target".into())
}

fn prefix_allocation(
    debt: &Obligation,
    value: Option<&str>,
) -> Result<(Money, UnitAllocation), String> {
    let value = value.ok_or("DRAFT_AMOUNT: supply an explicit integer minor-unit amount")?;
    let amount = Money::new(value, &debt.amount.currency)?;
    if amount.validate()? == 0 || amount.validate()? > debt.amount.validate()? {
        return Err("DRAFT_AMOUNT: this guided draft requires a positive prefix range within the exact obligation principal".into());
    }
    Ok((
        amount,
        UnitAllocation {
            obligation_id: debt.id.clone(),
            basis_agreement_hash: debt.basis_agreement_hash.clone(),
            start: "0".into(),
            end: value.into(),
        },
    ))
}

pub fn action(
    kind: &str,
    input: &AssignmentBundle,
    trust: &TrustConfiguration,
    target_id: Option<&str>,
    amount: Option<&str>,
) -> Result<ActionProposal, String> {
    let (a, report) = current(input, trust)?;
    let mut parents = BTreeSet::from([report.current_agreement_hash.clone()]);
    let mut allocations = Vec::new();
    let action = match kind {
        "ack" => {
            if amount.is_some() {
                return Err("DRAFT_AMOUNT: acknowledgment uses the signed milestone compensation; omit amount".into());
            }
            let hash = target(target_id)?;
            let event =
                report.transcript.proof_events.get(hash).ok_or(
                    "DRAFT_COMPLETION: exact authenticated completion proof is unavailable",
                )?;
            if event.envelope.author_role != "O"
                || event.envelope.agreement_hash != report.current_agreement_hash
            {
                return Err("DRAFT_COMPLETION: completion must be authored by O under the current Agreement".into());
            }
            let EventBody::CompletionClaim { milestone_id, .. } = &event.envelope.body else {
                return Err("DRAFT_COMPLETION: target is not a completion claim".into());
            };
            parents.insert(hash.into());
            Action::AcknowledgeCompletion {
                completion_event_hash: hash.into(),
                milestone_id: milestone_id.clone(),
            }
        }
        "receipt" | "settlement" => {
            let debt = obligation(&report, target(target_id)?)?;
            let (amount, allocation) = prefix_allocation(debt, amount)?;
            parents.extend(debt.certificate_ids.iter().cloned());
            allocations.push(allocation);
            if kind == "receipt" {
                Action::PaymentReceipt {
                    payment_id: unique_id("synthetic-payment")?,
                    obligation_id: debt.id.clone(),
                    amount,
                    rail_reference: SYNTHETIC.into(),
                }
            } else {
                if debt.debtor != Role::Requester || debt.creditor != Role::Operator {
                    return Err("DRAFT_SETTLEMENT: R/O settlement cannot release another party's obligation".into());
                }
                Action::BilateralSettlement {
                    settlement_id: unique_id("synthetic-settlement")?,
                    releases: vec![BalanceRelease {
                        obligation_id: debt.id.clone(),
                        amount,
                    }],
                    reservation_of_other_rights: format!(
                        "{SYNTHETIC} Only the exact signed unit range is released; all other rights are reserved."
                    ),
                }
            }
        }
        "reversal" => {
            let receipt = target(target_id)?;
            let payment = report.payments.iter().find(|p| p.certificate_id == receipt && p.kind == "PAYEE_SIGNED_RECEIPT")
                .ok_or("DRAFT_RECEIPT: target must be an exact retained payee-signed receipt proposal digest")?;
            let debt = obligation(&report, &payment.obligation_id)?;
            let (amount, allocation) = prefix_allocation(debt, amount)?;
            let grant = debt
                .credit_grants
                .iter()
                .find(|g| g.certificate_id == receipt)
                .ok_or("DRAFT_RECEIPT: receipt has no retained grant")?;
            // This bounded adapter supports one prefix, never guessing other units.
            let mut ranges = grant
                .allocations
                .iter()
                .filter(|r| {
                    r.obligation_id == debt.id
                        && r.basis_agreement_hash == debt.basis_agreement_hash
                })
                .map(|r| Ok((parse_minor_units(&r.start)?, parse_minor_units(&r.end)?)))
                .collect::<Result<Vec<_>, String>>()?;
            ranges.sort_unstable();
            let mut through = 0;
            for (start, end) in ranges {
                if start > through {
                    break;
                }
                through = through.max(end);
            }
            if through < amount.validate()? {
                return Err("DRAFT_RECEIPT: the requested prefix is outside this receipt's exact grant; review explicit unit ranges separately".into());
            }
            parents.insert(receipt.into());
            allocations.push(allocation);
            Action::ReconcileReversal {
                payment_certificate_id: receipt.into(),
                amount,
                reason: format!(
                    "{SYNTHETIC} All-party reconciliation of the exact named receipt grant."
                ),
            }
        }
        "activate" => {
            if amount.is_some() {
                return Err(
                    "DRAFT_AMOUNT: activation uses the exact signed service terms; omit amount"
                        .into(),
                );
            }
            let Assurance::Service { id, .. } = &a.assurance else {
                return Err(
                    "DRAFT_SERVICE: this Agreement has no protection service to activate".into(),
                );
            };
            if target_id.is_some_and(|target| target != id) {
                return Err(
                    "DRAFT_SERVICE: target differs from the exact Agreement service".into(),
                );
            }
            Action::ActivateProtectionService {
                commitment_id: id.clone(),
            }
        }
        _ => {
            return Err(
                "DRAFT_KIND: action kind must be ack, receipt, settlement, reversal, or activate"
                    .into(),
            );
        }
    };
    let scope_version = if matches!(&action, Action::ActivateProtectionService { .. }) {
        a.revision.clone()
    } else {
        "0".into()
    };
    let mut proposal = ActionProposal {
        protocol_version: PROTOCOL_VERSION.into(),
        deployment_domain: a.deployment_domain.clone(),
        assignment_id: a.assignment_id.clone(),
        agreement_hash: report.current_agreement_hash,
        policy_hash: a.policy_hash.clone(),
        scope_id: String::new(),
        parent_certificate_ids: parents.into_iter().collect(),
        scope_version,
        nonce: unique_id("synthetic-action")?,
        allocations,
        cutover: None,
        action,
    };
    proposal.scope_id = actions::expected_scope(&proposal, &a)?;
    actions::validate_proposal(&proposal, &a)?;
    Ok(proposal)
}

fn from_value<T: DeserializeOwned>(value: &serde_json::Value) -> Result<T, String> {
    encoding::strict_parse(&encoding::canonical(value)?)
}

/// Append the exact supplied record. Invalid signatures remain visible to verification.
pub fn attach(
    kind: &str,
    input: &AssignmentBundle,
    object: serde_json::Value,
    proposal: Option<ActionProposal>,
) -> Result<AssignmentBundle, String> {
    if kind != "action-signature" && proposal.is_some() {
        return Err("DRAFT_ATTACH: a proposal is only accepted with an action-signature".into());
    }
    let mut output = input.clone();
    match kind {
        "endorsement" => output
            .agreement
            .signatures
            .push(from_value::<crypto::DetachedSignature>(&object)?),
        "event" => output.events.push(from_value::<SignedEvent>(&object)?),
        "attachment" => output.attachments.push(from_value::<Attachment>(&object)?),
        "action-signature" => output.actions.push(ActionCertificate {
            proposal: proposal
                .ok_or("DRAFT_ATTACH: action-signature requires the exact reviewed proposal")?,
            authorizations: vec![from_value::<crypto::DetachedSignature>(&object)?],
        }),
        _ => {
            return Err(
                "DRAFT_ATTACH: kind must be endorsement, action-signature, event, or attachment"
                    .into(),
            );
        }
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (AssignmentBundle, TrustConfiguration) {
        let b = template().unwrap();
        let trust = TrustConfiguration {
            protocol_version: PROTOCOL_VERSION.into(),
            deployment_domain: b.deployment_domain.clone(),
            parties: b.agreement.agreement.parties.clone(),
        };
        (b, trust)
    }

    #[test]
    fn unsigned_request_rebinds_trust_and_fresh_ids() {
        let (_, mut trust) = fixture();
        trust.deployment_domain = "synthetic.local".into();
        trust.parties[0].party_id = "independent-R".into();
        let first = request(&trust).unwrap();
        let next = request(&trust).unwrap();
        assert_eq!(first.requester, trust.parties[0]);
        assert_eq!(first.deployment_domain, trust.deployment_domain);
        assert_ne!(first.request_id, next.request_id);
        assert!(first.service.description.contains("SYNTHETIC"));
        assert!(
            serde_json::to_value(first)
                .unwrap()
                .get("authorization")
                .is_none()
        );
        trust.protocol_version = "1".into();
        assert!(request(&trust).is_err());
    }

    #[test]
    fn quote_and_agreement_bind_only_supplied_signed_records() {
        let (b, trust) = fixture();
        let r = b.requests[0].clone();
        let q = quote(&r, &trust).unwrap();
        assert_eq!(q.request_hash, encoding::digest(&r.request).unwrap());
        assert_eq!(
            q.service_hash,
            encoding::digest(&r.request.service).unwrap()
        );
        assert_eq!(
            q.accepted_terms_hash,
            encoding::digest(&r.request.terms).unwrap()
        );
        let draft = agreement(r.clone(), b.agreement.agreement.quote.clone(), &trust).unwrap();
        assert!(draft.agreement.signatures.is_empty());
        assert!(
            draft.actions.is_empty() && draft.events.is_empty() && draft.attachments.is_empty()
        );
        assert_eq!(
            encoding::digest(&draft.requests[0]).unwrap(),
            encoding::digest(&r).unwrap()
        );
        assert_eq!(draft.agreement.agreement.legal.artifacts, r.request.terms);
        assert!(
            !bundle::verify_assignment_bundle(&draft, &trust)
                .unwrap()
                .agreement
                .bound
        );
        assert!(
            event("completion", &draft, &trust)
                .unwrap_err()
                .starts_with("DRAFT_UNBOUND")
        );
        let mut changed = r;
        changed.request.service.description.push_str(" changed");
        assert!(quote(&changed, &trust).is_err());
    }

    #[test]
    fn completion_uses_next_own_stream_and_verified_synthetic_bytes() {
        let (b, trust) = fixture();
        let e = event("completion", &b, &trust).unwrap();
        assert_eq!(e.author_role, "O");
        assert_eq!(e.sequence, "1");
        let previous = &b
            .events
            .iter()
            .find(|e| e.envelope.author_role == "O")
            .unwrap()
            .envelope;
        assert_eq!(
            e.previous_event_hash,
            Some(encoding::digest(previous).unwrap())
        );
        let EventBody::CompletionClaim { manifest, .. } = e.body else {
            panic!("completion expected")
        };
        let index = evidence::index_attachments(&[synthetic_attachment().unwrap()]);
        assert_eq!(
            evidence::validate_manifest(&manifest, &index).status,
            "INTEGRITY_VALID"
        );
        let observation = event("payer-observation", &b, &trust).unwrap();
        assert_eq!(observation.author_role, "R");
        assert!(matches!(observation.body, EventBody::PayerStatement { .. }));
        assert!(matches!(
            event("dispute", &b, &trust).unwrap().body,
            EventBody::DisputeOpened { .. }
        ));
    }

    #[test]
    fn financial_drafts_bind_exact_targets_principal_and_ranges() {
        let (b, trust) = fixture();
        let receipt = action("receipt", &b, &trust, Some("milestone:work"), Some("6000")).unwrap();
        assert_eq!(receipt.allocations[0].start, "0");
        assert_eq!(receipt.allocations[0].end, "6000");
        assert_eq!(
            receipt.allocations[0].basis_agreement_hash,
            encoding::digest(&b.agreement.agreement).unwrap()
        );
        assert!(action("receipt", &b, &trust, Some("milestone:work"), None).is_err());
        assert!(action("receipt", &b, &trust, Some("milestone:work"), Some("10001")).is_err());
        assert!(action("receipt", &b, &trust, Some("milestone:missing"), Some("1")).is_err());
        assert!(action("activate", &b, &trust, None, None).is_err());
        let original = b
            .actions
            .iter()
            .find(|c| matches!(c.proposal.action, Action::PaymentReceipt { .. }))
            .unwrap();
        let id = encoding::digest(&original.proposal).unwrap();
        let reversal = action("reversal", &b, &trust, Some(&id), Some("1000")).unwrap();
        assert!(reversal.parent_certificate_ids.contains(&id));
        assert_eq!(reversal.allocations[0].end, "1000");
    }

    #[test]
    fn guided_actions_pass_existing_core_preflight_without_signing() {
        let (b, trust) = fixture();
        let completion = b
            .events
            .iter()
            .find(|event| matches!(event.envelope.body, EventBody::CompletionClaim { .. }))
            .unwrap();
        let completion_hash = encoding::digest(&completion.envelope).unwrap();
        let ack = action("ack", &b, &trust, Some(&completion_hash), None).unwrap();
        actions::prepare_action_signature(&ack, &b, &trust, Role::Requester).unwrap();
        assert!(actions::prepare_action_signature(&ack, &b, &trust, Role::Mediator).is_err());
        for (kind, role) in [("receipt", Role::Operator), ("settlement", Role::Requester)] {
            let proposal = action(kind, &b, &trust, Some("milestone:work"), Some("1000")).unwrap();
            actions::prepare_action_signature(&proposal, &b, &trust, role).unwrap();
        }
        let receipt = b
            .actions
            .iter()
            .find(|c| matches!(c.proposal.action, Action::PaymentReceipt { .. }))
            .unwrap();
        let proposal = action(
            "reversal",
            &b,
            &trust,
            Some(&encoding::digest(&receipt.proposal).unwrap()),
            Some("1000"),
        )
        .unwrap();
        actions::prepare_action_signature(&proposal, &b, &trust, Role::Mediator).unwrap();
    }

    #[test]
    fn append_retains_exact_invalid_and_duplicate_records_for_verifier() {
        let (b, trust) = fixture();
        let mut signature = b.agreement.signatures[0].clone();
        signature.claims.content_hash = "0".repeat(64);
        let object = serde_json::to_value(&signature).unwrap();
        let once = attach("endorsement", &b, object.clone(), None).unwrap();
        let twice = attach("endorsement", &once, object, None).unwrap();
        assert_eq!(
            twice.agreement.signatures.len(),
            b.agreement.signatures.len() + 2
        );
        assert_eq!(twice.agreement.signatures.last().unwrap(), &signature);
        assert!(
            bundle::verify_assignment_bundle(&twice, &trust)
                .unwrap()
                .agreement
                .bound
        );
        let cert = b.actions[0].clone();
        let extended = attach(
            "action-signature",
            &b,
            serde_json::to_value(&cert.authorizations[0]).unwrap(),
            Some(cert.proposal.clone()),
        )
        .unwrap();
        assert_eq!(
            encoding::digest(&extended.actions.last().unwrap().proposal).unwrap(),
            encoding::digest(&cert.proposal).unwrap()
        );
        assert_eq!(
            extended.actions.last().unwrap().authorizations[0],
            cert.authorizations[0]
        );
    }
}
