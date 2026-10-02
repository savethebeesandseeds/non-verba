#![allow(dead_code)]
// SPDX-License-Identifier: AGPL-3.0-only
//! Deterministic PUBLIC TEST KEYS. Never use these keys or fixtures for real work.

use nonverba_requests::{
    actions, agreement, crypto, encoding, model::*, money::Money, transcript::*,
};
use p256::ecdsa::SigningKey;

pub const TEST_DOMAIN: &str = "nonverba.test";
pub const EVIDENCE_BYTES: &[u8] =
    b"Exact synthetic digital deliverable. No physical performance claim is proved.";
pub const CLAUSE: &str = "No combination of parties gains authority over another party merely by agreeing with one another. Within the Assignment Protocol, an effect on a party's protected rights must be supported by that party's authorization or by a specific rule previously accepted by that party and applied with its required proof. Mediation proposals and unsupported assertions do not themselves change obligations. Amendments and settlements have only the scope authorized in the Assignment Record. This does not exclude mandatory legal rights or the authority of competent external bodies.";

pub fn artifact(id: &str, text: &str) -> TextArtifact {
    TextArtifact {
        id: id.into(),
        version: "1".into(),
        media_type: "text/plain".into(),
        text: text.into(),
    }
}
pub fn key_index(role: Role) -> usize {
    match role {
        Role::Requester => 0,
        Role::Operator => 1,
        Role::Mediator => 2,
    }
}
pub fn money(value: &str) -> Money {
    Money::new(value, "EUR").unwrap()
}

pub fn fixture() -> (AssignmentBundle, TrustConfiguration, [SigningKey; 3]) {
    let keys = [21u8, 22, 23].map(|n| SigningKey::from_bytes((&[n; 32]).into()).unwrap());
    let parties: Vec<_> = [Role::Requester, Role::Operator, Role::Mediator]
        .into_iter()
        .map(|role| PartyBinding {
            role,
            party_id: format!("test-party-{}", role.code()),
            identity_record: artifact(
                &format!("test-identity-{}", role.code()),
                "Public synthetic identity; not onboarding evidence.",
            ),
            key: crypto::key_binding(
                role.code(),
                &format!("public-test-key-{}", role.code()),
                &keys[key_index(role)],
            ),
        })
        .collect();
    let trust = TrustConfiguration {
        protocol_version: PROTOCOL_VERSION.into(),
        deployment_domain: TEST_DOMAIN.into(),
        parties: parties.clone(),
    };
    let service = Service {
        description: "Produce the agreed digital test deliverable.".into(),
        deliverables: vec!["One specified artifact.".into()],
        exclusions: vec!["No claim to verified physical performance.".into()],
        location: None,
        prerequisites: vec![],
        requester_inputs: vec!["Provide the source material.".into()],
        safety_stop_conditions: vec!["Stop if unsafe.".into()],
        execution_resources: vec!["Operator-controlled test client.".into()],
    };
    let request = Request {
        protocol_version: PROTOCOL_VERSION.into(),
        deployment_domain: TEST_DOMAIN.into(),
        request_id: "test-request-1".into(),
        revision: "1".into(),
        requester: parties[0].clone(),
        service: service.clone(),
        terms: vec![artifact(
            "platform-terms",
            &format!("{CLAUSE}\n\n{NON_RETRACTION}"),
        )],
        accepts_platform_terms: true,
    };
    let signed_request = SignedRequest {
        authorization: crypto::sign(
            &agreement::claims(
                TEST_DOMAIN,
                &request.request_id,
                &encoding::digest(&request).unwrap(),
                &parties[0],
                "REQUEST",
            ),
            &keys[0],
        )
        .unwrap(),
        request,
    };
    let request_hash = encoding::digest(&signed_request.request).unwrap();
    let quote = Quote {
        protocol_version: PROTOCOL_VERSION.into(),
        deployment_domain: TEST_DOMAIN.into(),
        quote_id: "test-quote-1".into(),
        request_hash: request_hash.clone(),
        service_hash: encoding::digest(&service).unwrap(),
        accepted_terms_hash: encoding::digest(&signed_request.request.terms).unwrap(),
        operator: parties[1].clone(),
        compensation: money("10000"),
        expenses: vec![ExpenseCap {
            category: "travel".into(),
            cap: money("2000"),
        }],
        milestones: vec![Milestone {
            id: "work".into(),
            deliverable: "One specified artifact.".into(),
            compensation: money("10000"),
        }],
    };
    let signed_quote = SignedQuote {
        authorization: crypto::sign(
            &agreement::claims(
                TEST_DOMAIN,
                &signed_request.request.request_id,
                &encoding::digest(&quote).unwrap(),
                &parties[1],
                "QUOTE",
            ),
            &keys[1],
        )
        .unwrap(),
        quote,
    };
    let policy = Policy {
        id: POLICY_ID.into(),
        version: "2".into(),
        artifact_rules: vec![],
        bilateral_balance_releases: true,
        payment_rule: PaymentRule::PayeeSignedReceipt,
        time_rule: TimeRule::RemindersOnly,
        no_commission: true,
        mediator_has_task_fund_control: false,
    };
    let agreement = AssignmentAgreement {
        protocol_version: PROTOCOL_VERSION.into(),
        schema_version: "2".into(),
        deployment_domain: TEST_DOMAIN.into(),
        assignment_id: "test-assignment-1".into(),
        request_id: signed_request.request.request_id.clone(),
        request_hash,
        revision: "1".into(),
        previous_agreement_hash: None,
        parties,
        policy_hash: encoding::digest(&policy).unwrap(),
        policy,
        service,
        quote: signed_quote,
        acceptance: vec![AcceptanceCriterion {
            id: "delivery".into(),
            milestone_id: "work".into(),
            description: "Requester judges agreed deliverable against exact scope.".into(),
            evaluation: Evaluation::RequesterJudgment,
        }],
        timing: Timing {
            start_window: "After local certificate readiness.".into(),
            completion_window: "Target next agreed day.".into(),
            review_window: "Reminder after one day.".into(),
            notices: "Signed receipt identifies bytes only.".into(),
            grace_extensions: "Extensions require agreed terms.".into(),
            time_assumptions: "No independent time source; no automatic adverse effects.".into(),
        },
        payments: PaymentTerms {
            payer: Role::Requester,
            payee: Role::Operator,
            rail: "bank-transfer".into(),
            destination: "operator-test-account".into(),
            due_conditions: "On authorized milestone entitlement.".into(),
            preconditions: vec![],
            reversal_treatment:
                "Reconcile only under scoped authorization; preserve disputed records.".into(),
        },
        mediation: MediationTerms {
            free: true,
            proposal_only: true,
            obligations: vec!["Offer nonbinding discussion.".into()],
            availability_commitment: "No guaranteed response time in this test.".into(),
            escalation: "Unresolved factual disputes remain unresolved.".into(),
        },
        assurance: Assurance::Disabled {
            reason: "No financial or nonfinancial protection product enabled.".into(),
        },
        remedies: Remedies {
            cancellation: "Notice alone creates no penalty or erasure.".into(),
            interruption: "Retain accrued claims.".into(),
            partial_completion: "Resolve explicit scoped claims.".into(),
            expenses: "Only separate authorized travel expenses within cap.".into(),
            escalation: "Independent lawful escalation remains available.".into(),
            preserve_accrued_claims: true,
        },
        privacy: Privacy {
            recipients: vec![Role::Requester, Role::Operator, Role::Mediator],
            purposes: vec!["Verify this synthetic assignment.".into()],
            retention: artifact(
                "retention",
                "Participants retain their exports; no real personal data in fixtures.",
            ),
            export_rights: "Each party can export independently.".into(),
            disclosure_rules: "Share only scoped evidence with authorized recipients.".into(),
        },
        legal: LegalTerms {
            artifacts: signed_request.request.terms.clone(),
            governing_law: None,
            jurisdiction: None,
            mandatory_rights_reserved: true,
            consent_text: "I authorize this exact Agreement and its embedded terms and policy."
                .into(),
        },
    };
    let mut bundle = AssignmentBundle {
        protocol_version: PROTOCOL_VERSION.into(),
        deployment_domain: TEST_DOMAIN.into(),
        requests: vec![signed_request],
        agreement: AgreementCertificate {
            agreement,
            signatures: vec![],
        },
        actions: vec![],
        events: vec![],
        attachments: vec![],
    };
    sign_root(&mut bundle, &keys);
    (bundle, trust, keys)
}

pub fn sign_root(bundle: &mut AssignmentBundle, keys: &[SigningKey; 3]) {
    let a = &bundle.agreement.agreement;
    let hash = encoding::digest(a).unwrap();
    bundle.agreement.signatures = a
        .parties
        .iter()
        .map(|party| {
            crypto::sign(
                &agreement::claims(
                    &a.deployment_domain,
                    &a.assignment_id,
                    &hash,
                    party,
                    "AGREEMENT",
                ),
                &keys[key_index(party.role)],
            )
            .unwrap()
        })
        .collect();
}

pub fn sign_quote(bundle: &mut AssignmentBundle, keys: &[SigningKey; 3]) {
    let a = &mut bundle.agreement.agreement;
    a.quote.authorization = crypto::sign(
        &agreement::claims(
            &a.deployment_domain,
            &a.request_id,
            &encoding::digest(&a.quote.quote).unwrap(),
            &a.quote.quote.operator,
            "QUOTE",
        ),
        &keys[1],
    )
    .unwrap();
}

pub fn artifact_fixture() -> (AssignmentBundle, TrustConfiguration, [SigningKey; 3]) {
    let (mut bundle, trust, keys) = fixture();
    let a = &mut bundle.agreement.agreement;
    a.acceptance[0].evaluation = Evaluation::ArtifactBytes;
    a.acceptance[0].description = "Only exact digital bytes; no physical truth conclusion.".into();
    a.policy.artifact_rules.push(ArtifactRule {
        id: "exact-artifact".into(),
        milestone_id: "work".into(),
        criterion_ids: vec!["delivery".into()],
        artifact_digests: vec![encoding::bytes_digest(EVIDENCE_BYTES)],
        effect: ArtifactEffect::EstablishMilestoneCompensation,
    });
    a.policy_hash = encoding::digest(&a.policy).unwrap();
    sign_root(&mut bundle, &keys);
    (bundle, trust, keys)
}

pub fn sign_action(
    bundle: &AssignmentBundle,
    keys: &[SigningKey; 3],
    action: Action,
    roles: &[Role],
    extra_parents: &[String],
    nonce: &str,
) -> ActionCertificate {
    let mut certificate = sign_action_for(
        &bundle.agreement.agreement,
        keys,
        action,
        roles,
        extra_parents,
        nonce,
    );
    certificate.proposal.allocations =
        bundle_allocations(bundle, &certificate.proposal.action, extra_parents);
    if matches!(certificate.proposal.action, Action::AmendAgreement { .. }) {
        let action_ids: std::collections::BTreeSet<_> = bundle
            .actions
            .iter()
            .map(|item| encoding::digest(&item.proposal).unwrap())
            .collect();
        let frontier: std::collections::BTreeSet<_> = action_ids
            .iter()
            .cloned()
            .chain(
                bundle
                    .events
                    .iter()
                    .map(|item| encoding::digest(&item.envelope).unwrap()),
            )
            .chain(extra_parents.iter().cloned())
            .collect();
        let root_hash = encoding::digest(&bundle.agreement.agreement).unwrap();
        certificate.proposal.parent_certificate_ids = std::iter::once(root_hash)
            .chain(frontier.iter().cloned())
            .collect();
        assert!(
            certificate.proposal.parent_certificate_ids.len() <= 64,
            "test amendment frontier exceeds protocol limit"
        );
        certificate.proposal.cutover = Some(AmendmentCutover {
            frontier: frontier.into_iter().collect(),
            preserved_claims: action_ids.into_iter().collect(),
            grandfathered_actions: vec![],
        });
    }
    resign_action_for(&bundle.agreement.agreement, keys, &mut certificate, roles);
    certificate
}

fn principal(a: &AssignmentAgreement, obligation_id: &str, fallback: u64) -> u64 {
    if let Some(milestone) = obligation_id.strip_prefix("milestone:")
        && let Some(item) = a
            .quote
            .quote
            .milestones
            .iter()
            .find(|item| item.id == milestone)
    {
        return item.compensation.validate().unwrap();
    }
    if let Assurance::Service { fee: Some(fee), .. } = &a.assurance
        && obligation_id == format!("protection:{}", fee.fee_id)
    {
        return fee.amount.validate().unwrap();
    }
    fallback
}

fn allocate(
    obligation_id: &str,
    basis: &str,
    amount: u64,
    principal: u64,
    covered: &[(u64, u64)],
) -> Vec<UnitAllocation> {
    let mut covered = covered.to_vec();
    covered.sort_unstable();
    let mut cursor = 0;
    let mut remaining = amount;
    let mut result = vec![];
    for (start, end) in covered.into_iter().chain([(principal, principal)]) {
        if cursor < start && remaining > 0 {
            let allocated_end = start.min(principal).min(cursor + remaining);
            if cursor < allocated_end {
                result.push(UnitAllocation {
                    obligation_id: obligation_id.into(),
                    basis_agreement_hash: basis.into(),
                    start: cursor.to_string(),
                    end: allocated_end.to_string(),
                });
                remaining -= allocated_end - cursor;
            }
        }
        cursor = cursor.max(end);
        if cursor >= principal || remaining == 0 {
            break;
        }
    }
    result
}

fn default_allocations(a: &AssignmentAgreement, action: &Action) -> Vec<UnitAllocation> {
    // This fixture family has a root and at most one replacement revision.
    // Accrued coordinates remain anchored to the root after that replacement.
    let basis = a
        .previous_agreement_hash
        .clone()
        .unwrap_or_else(|| encoding::digest(a).unwrap());
    match action {
        Action::PaymentReceipt {
            obligation_id,
            amount,
            ..
        } => {
            let value = amount.validate().unwrap();
            allocate(
                obligation_id,
                &basis,
                value,
                principal(a, obligation_id, value),
                &[],
            )
        }
        Action::BilateralSettlement { releases, .. } => {
            let mut allocations: Vec<_> = releases
                .iter()
                .flat_map(|release| {
                    let value = release.amount.validate().unwrap();
                    allocate(
                        &release.obligation_id,
                        &basis,
                        value,
                        principal(a, &release.obligation_id, value),
                        &[],
                    )
                })
                .collect();
            allocations.sort_by(|left, right| {
                left.obligation_id.cmp(&right.obligation_id).then_with(|| {
                    left.start
                        .parse::<u64>()
                        .unwrap()
                        .cmp(&right.start.parse::<u64>().unwrap())
                })
            });
            allocations
        }
        _ => vec![],
    }
}

fn bundle_allocations(
    bundle: &AssignmentBundle,
    action: &Action,
    parents: &[String],
) -> Vec<UnitAllocation> {
    let a = &bundle.agreement.agreement;
    let basis = encoding::digest(a).unwrap();
    let by_hash: std::collections::BTreeMap<_, _> = bundle
        .actions
        .iter()
        .map(|certificate| {
            (
                encoding::digest(&certificate.proposal).unwrap(),
                certificate,
            )
        })
        .collect();
    if let Action::ReconcileReversal {
        payment_certificate_id,
        amount,
        ..
    } = action
    {
        if let Some(target) = by_hash.get(payment_certificate_id) {
            let mut remaining = amount.validate().unwrap();
            return target
                .proposal
                .allocations
                .iter()
                .filter_map(|allocation| {
                    if remaining == 0 {
                        return None;
                    }
                    let start = allocation.start.parse::<u64>().unwrap();
                    let end = allocation
                        .end
                        .parse::<u64>()
                        .unwrap()
                        .min(start + remaining);
                    remaining -= end - start;
                    Some(UnitAllocation {
                        start: start.to_string(),
                        end: end.to_string(),
                        ..allocation.clone()
                    })
                })
                .collect();
        }
        return vec![];
    }
    let mut pending = parents.to_vec();
    let mut ancestors = std::collections::BTreeSet::new();
    while let Some(hash) = pending.pop() {
        if ancestors.insert(hash.clone())
            && let Some(certificate) = by_hash.get(&hash)
        {
            pending.extend(certificate.proposal.parent_certificate_ids.iter().cloned());
        }
    }
    let mut allocations = default_allocations(a, action);
    let requests: Vec<_> = match action {
        Action::PaymentReceipt {
            obligation_id,
            amount,
            ..
        } => vec![(obligation_id, amount)],
        Action::BilateralSettlement { releases, .. } => releases
            .iter()
            .map(|release| (&release.obligation_id, &release.amount))
            .collect(),
        _ => return allocations,
    };
    allocations.clear();
    for (obligation_id, amount) in requests {
        let value = amount.validate().unwrap();
        let covered: Vec<_> = ancestors
            .iter()
            .filter_map(|hash| by_hash.get(hash))
            .flat_map(|certificate| {
                if matches!(
                    certificate.proposal.action,
                    Action::PaymentReceipt { .. } | Action::BilateralSettlement { .. }
                ) {
                    certificate
                        .proposal
                        .allocations
                        .iter()
                        .filter(|allocation| &allocation.obligation_id == obligation_id)
                        .map(|allocation| {
                            (
                                allocation.start.parse::<u64>().unwrap(),
                                allocation.end.parse::<u64>().unwrap(),
                            )
                        })
                        .collect()
                } else {
                    vec![]
                }
            })
            .collect();
        let bound = if let Some(expense_id) = obligation_id.strip_prefix("expense:") {
            bundle
                .actions
                .iter()
                .find_map(|certificate| match &certificate.proposal.action {
                    Action::AuthorizeExpense {
                        expense_id: id,
                        amount,
                        ..
                    } if id == expense_id => Some(amount.validate().unwrap()),
                    _ => None,
                })
                .unwrap_or(value)
        } else {
            principal(a, obligation_id, value)
        };
        allocations.extend(allocate(obligation_id, &basis, value, bound, &covered));
    }
    allocations.sort_by(|left, right| {
        left.obligation_id.cmp(&right.obligation_id).then_with(|| {
            left.start
                .parse::<u64>()
                .unwrap()
                .cmp(&right.start.parse::<u64>().unwrap())
        })
    });
    allocations
}

pub fn resign_action_for(
    a: &AssignmentAgreement,
    keys: &[SigningKey; 3],
    certificate: &mut ActionCertificate,
    roles: &[Role],
) {
    let hash = encoding::digest(&certificate.proposal).unwrap();
    certificate.authorizations = roles
        .iter()
        .map(|role| {
            let party = agreement::party(a, *role).unwrap();
            crypto::sign(
                &agreement::claims(
                    &a.deployment_domain,
                    &a.assignment_id,
                    &hash,
                    party,
                    "ACTION",
                ),
                &keys[key_index(*role)],
            )
            .unwrap()
        })
        .collect();
}

pub fn sign_action_for(
    a: &AssignmentAgreement,
    keys: &[SigningKey; 3],
    action: Action,
    roles: &[Role],
    extra_parents: &[String],
    nonce: &str,
) -> ActionCertificate {
    let agreement_hash = encoding::digest(a).unwrap();
    let mut parents = vec![agreement_hash.clone()];
    for parent in extra_parents {
        if !parents.contains(parent) {
            parents.push(parent.clone());
        }
    }
    let scope_version = if matches!(
        action,
        Action::AmendAgreement { .. } | Action::ActivateProtectionService { .. }
    ) {
        a.revision.clone()
    } else {
        "0".into()
    };
    let allocations = default_allocations(a, &action);
    let cutover = matches!(action, Action::AmendAgreement { .. }).then(|| AmendmentCutover {
        frontier: extra_parents.to_vec(),
        preserved_claims: extra_parents.to_vec(),
        grandfathered_actions: vec![],
    });
    let mut proposal = ActionProposal {
        protocol_version: PROTOCOL_VERSION.into(),
        deployment_domain: a.deployment_domain.clone(),
        assignment_id: a.assignment_id.clone(),
        agreement_hash,
        policy_hash: a.policy_hash.clone(),
        scope_id: String::new(),
        parent_certificate_ids: parents,
        scope_version,
        nonce: nonce.into(),
        allocations,
        cutover,
        action,
    };
    proposal.scope_id = actions::expected_scope(&proposal, a).unwrap();
    let hash = encoding::digest(&proposal).unwrap();
    let authorizations = roles
        .iter()
        .map(|role| {
            let party = agreement::party(a, *role).unwrap();
            crypto::sign(
                &agreement::claims(
                    &a.deployment_domain,
                    &a.assignment_id,
                    &hash,
                    party,
                    "ACTION",
                ),
                &keys[key_index(*role)],
            )
            .unwrap()
        })
        .collect();
    ActionCertificate {
        proposal,
        authorizations,
    }
}

pub fn event(
    bundle: &AssignmentBundle,
    keys: &[SigningKey; 3],
    role: Role,
    sequence: u64,
    previous: Option<&SignedEvent>,
    references: Vec<String>,
    body: EventBody,
) -> SignedEvent {
    let a = &bundle.agreement.agreement;
    let envelope = EventEnvelope {
        protocol_version: PROTOCOL_VERSION.into(),
        deployment_domain: a.deployment_domain.clone(),
        assignment_id: a.assignment_id.clone(),
        agreement_hash: encoding::digest(a).unwrap(),
        author_role: role.code().into(),
        key_id: agreement::party(a, role).unwrap().key.key_id.clone(),
        key_epoch: "1".into(),
        sequence: sequence.to_string(),
        previous_event_hash: previous.map(|event| encoding::digest(&event.envelope).unwrap()),
        nonce: format!("event-{}-{sequence}", role.code()),
        causal_references: references,
        claimed_creation_time: None,
        body,
    };
    sign_event(&envelope, &keys[key_index(role)]).unwrap()
}

pub fn completion(bundle: &mut AssignmentBundle, keys: &[SigningKey; 3]) -> String {
    let digest = encoding::bytes_digest(EVIDENCE_BYTES);
    let manifest = EvidenceManifest {
        artifacts: vec![ArtifactRef {
            sha256: digest.clone(),
            byte_length: EVIDENCE_BYTES.len().to_string(),
            media_type: "text/plain".into(),
            capture_reference: None,
        }],
        description: "Synthetic bytes, no truthful-physical-performance assertion.".into(),
    };
    let completion = event(
        bundle,
        keys,
        Role::Operator,
        0,
        None,
        vec![],
        EventBody::CompletionClaim {
            milestone_id: "work".into(),
            manifest,
        },
    );
    let hash = encoding::digest(&completion.envelope).unwrap();
    bundle.events.push(completion);
    bundle.attachments.push(Attachment {
        sha256: digest,
        bytes_b64: crypto::encode_base64url(EVIDENCE_BYTES),
    });
    hash
}

pub fn establish_compensation(bundle: &mut AssignmentBundle, keys: &[SigningKey; 3]) -> String {
    let completion_hash = completion(bundle, keys);
    let certificate = sign_action(
        bundle,
        keys,
        Action::AcknowledgeCompletion {
            completion_event_hash: completion_hash.clone(),
            milestone_id: "work".into(),
        },
        &[Role::Requester],
        &[completion_hash],
        "acknowledge-work",
    );
    let hash = encoding::digest(&certificate.proposal).unwrap();
    bundle.actions.push(certificate);
    hash
}

pub fn next_agreement(bundle: &AssignmentBundle) -> AssignmentAgreement {
    let mut next = bundle.agreement.agreement.clone();
    next.revision = "2".into();
    next.previous_agreement_hash = Some(encoding::digest(&bundle.agreement.agreement).unwrap());
    next.timing.review_window = "An amended reminder window; no silent forfeiture.".into();
    next
}

pub fn service_fixture() -> (AssignmentBundle, TrustConfiguration, [SigningKey; 3]) {
    let (mut bundle, trust, keys) = fixture();
    bundle.agreement.agreement.assurance = Assurance::Service {
        id: "evidence-assistance".into(),
        provider: Role::Mediator,
        beneficiaries: vec![Role::Requester, Role::Operator],
        services: vec!["Preserve supplied synthetic records and assist their export.".into()],
        limits: "No compensation promise; no insurance or guarantee of performance.".into(),
        triggers: "Activated only by all-party scoped action.".into(),
        exclusions: vec!["No debt enforcement, physical adjudication, or custody.".into()],
        evidence_requirements: "Exact signed records supplied by the participants.".into(),
        claim_path: "Submit attributed assurance claim.".into(),
        challenge_path: "Preserve disputed assessment; seek independent lawful escalation.".into(),
        prerequisites: vec![],
        response_commitment:
            "Only the explicit record-export assistance undertaking; no invented SLA.".into(),
        fee: Some(ProtectionFee {
            fee_id: "assistance-fee".into(),
            payer: Role::Requester,
            provider: Role::Mediator,
            amount: money("500"),
            destination: "mediator-test-service-account".into(),
            service_scope: "Separate nonfinancial record assistance.".into(),
            due_conditions: "On all-party service activation.".into(),
        }),
        financial_compensation: false,
    };
    sign_root(&mut bundle, &keys);
    (bundle, trust, keys)
}
