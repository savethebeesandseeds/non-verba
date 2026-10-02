// SPDX-License-Identifier: AGPL-3.0-only
//! Retained previews contain the exact typed signed object, not a UI summary.
use nonverba_requests::{
    actions, bundle, encoding,
    model::*,
    money::Money,
    rights,
    transcript::{EventBody, EventEnvelope},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Review {
    pub adapter_version: String,
    pub kind: String,
    pub content_hash: String,
    pub exact_content: Value,
    pub context_hash: Option<String>,
    pub retained_context: Option<Value>,
}

fn typed<T: serde::de::DeserializeOwned + Serialize>(value: Value) -> Result<Value, String> {
    let object: T = serde_json::from_value(value).map_err(|e| format!("REVIEW_SCHEMA: {e}"))?;
    serde_json::to_value(object).map_err(|e| format!("REVIEW_SCHEMA: {e}"))
}

fn json<T: Serialize + ?Sized>(value: &T) -> Result<String, String> {
    serde_json::to_string(value).map_err(|e| format!("REVIEW_DISPLAY: {e}"))
}

fn amount(value: &Money) -> Result<String, String> {
    let minor = value.validate()?;
    let scale = 10_u64.pow(u32::from(value.exponent));
    let decimal = if value.exponent == 0 {
        minor.to_string()
    } else {
        format!(
            "{}.{:0width$}",
            minor / scale,
            minor % scale,
            width = usize::from(value.exponent)
        )
    };
    Ok(format!(
        "{} {decimal} ({} minor units; exponent {})",
        value.currency, value.minor_units, value.exponent
    ))
}

/// Locate exact retained text only. Authentication, when requested, uses the core.
fn declared_agreement(
    input: &AssignmentBundle,
    hash: &str,
) -> Result<Option<AssignmentAgreement>, String> {
    if encoding::digest(&input.agreement.agreement)? == hash {
        return Ok(Some(input.agreement.agreement.clone()));
    }
    for certificate in &input.actions {
        if let Action::AmendAgreement { replacement } = &certificate.proposal.action
            && encoding::digest(replacement)? == hash
        {
            return Ok(Some(replacement.as_ref().clone()));
        }
    }
    Ok(None)
}

fn existing_obligation(text: &mut String, obligation: &Obligation) -> Result<(), String> {
    text.push_str("\nEXISTING VERIFIED OBLIGATION (supplied local view)\n");
    text.push_str(&format!(
        "ID: {}\nDebtor role: {}; creditor role: {}\nRecorded principal: {}\nOutstanding minor units: {}\nImmutable unit basis: {}\nEstablishment/retained certificate references: {}\nExact retained due conditions: {}\n",
        json(&obligation.id)?,
        obligation.debtor.code(),
        obligation.creditor.code(),
        amount(&obligation.amount)?,
        json(&obligation.unresolved_balance)?,
        json(&obligation.basis_agreement_hash)?,
        json(&obligation.certificate_ids)?,
        json(&obligation.due_conditions)?,
    ));
    text.push_str("Recorded principal or an outstanding amount does not establish that every payment condition has occurred. Narrative due conditions are retained, not generally interpreted by the verifier.\n");
    Ok(())
}

fn existing_grants(text: &mut String, obligation: &Obligation) -> Result<(), String> {
    text.push_str(&format!(
        "Existing credit grants (including revoked units): {}\nExisting release grants: {}\nExisting credit/release overlap, minor units: {}\n",
        json(&obligation.credit_grants)?,
        json(&obligation.release_grants)?,
        json(&obligation.overlap_amount)?,
    ));
    text.push_str("Overlapping units count once. These are existing verified grants, not a prediction of the balance after this proposal. The stated amount and allocated coverage do not imply that the outstanding balance falls by either whole amount.\n");
    Ok(())
}

fn completion_evidence(
    text: &mut String,
    report: Option<&BundleReport>,
    hash: &str,
) -> Result<(), String> {
    text.push_str("\nEVIDENCE AVAILABILITY AND INTEGRITY\n");
    if let Some(result) =
        report.and_then(|r| r.evidence_integrity.iter().find(|e| e.event_hash == hash))
    {
        text.push_str(&format!(
            "Core evidence report for the exact completion: {}\n",
            json(result)?
        ));
        text.push_str("Missing bytes were not examined. Digest/length matches do not verify physical performance or declared media type. Evidence integrity, authenticated authorship and the decision to acknowledge are separate.\n");
    } else {
        text.push_str("No authenticated-context evidence report is available for this exact completion. No attachment is claimed to have been examined.\n");
    }
    text.push_str("A valid milestone acknowledgment can establish compensation even when attachments are missing or invalid; it adds no unstated release of remedies.\n");
    Ok(())
}

fn action_consequences(
    proposal: &ActionProposal,
    input: &AssignmentBundle,
    report: Option<&BundleReport>,
    trust: Option<&TrustConfiguration>,
) -> Result<String, String> {
    let mut text = format!(
        "Referenced Agreement: {}\nRequired role authorizations: {}\n",
        json(&proposal.agreement_hash)?,
        json(&actions::required_authorizers(&proposal.action))?,
    );
    if actions::required_authorizers(&proposal.action).is_empty() {
        text.push_str(
            "At least one independently authenticated R/O/M submitter is still required.\n",
        );
    }
    let (agreement, preflight_ok) = if let Some(trust) = trust {
        let agreement = bundle::known_agreement(input, &proposal.agreement_hash, trust);
        let preflight = bundle::validate_unsigned_action(proposal, input, trust);
        match &preflight {
            Ok(()) => text.push_str("Core unsigned-action preflight: PASSED for the supplied view. This is not a signature or an executed new effect.\n"),
            Err(error) => text.push_str(&format!("Core unsigned-action preflight: REJECTED: {}. No proposed financial effect is confirmed.\n", json(error)?)),
        }
        match agreement {
            Ok(a) => (Some(a), preflight.is_ok()),
            Err(error) => {
                text.push_str(&format!(
                    "Exact referenced Agreement could not be authenticated: {}\n",
                    json(&error)?
                ));
                (None, false)
            }
        }
    } else {
        text.push_str("No independent trust was supplied: the following describes unsigned content and matching retained text only. No Agreement authority, existing obligation, evidence status or balance has been authenticated.\n");
        (declared_agreement(input, &proposal.agreement_hash)?, false)
    };
    let proposal_id = encoding::digest(proposal)?;
    match &proposal.action {
        Action::AcknowledgeCompletion { milestone_id, completion_event_hash } => {
            text.push_str("\nREQUESTER MILESTONE ACKNOWLEDGMENT\n");
            text.push_str(&format!("Milestone: {}\nExact completion: {}\n", json(milestone_id)?, json(completion_event_hash)?));
            text.push_str("This proposes acknowledgment of the identified milestone completion. It is not merely acknowledgment that a message or file arrived.\n");
            if (preflight_ok || trust.is_none()) && let Some(a) = &agreement {
                if let Some(milestone) = a.quote.quote.milestones.iter().find(|m| &m.id == milestone_id) {
                    text.push_str(&format!("{}: {}\n", if preflight_ok { "Agreed milestone compensation this acknowledgment would recognize" } else { "Declared compensation in exact matching Agreement text (UNAUTHENTICATED)" }, amount(&milestone.compensation)?));
                    let existing = report.and_then(|r| r.obligations.iter().find(|o| o.id == format!("milestone:{milestone_id}")));
                    if let Some(obligation) = existing {
                        text.push_str("This obligation is already established in the supplied verified view. Another compatible acknowledgment does not create an additional charge.\n");
                        existing_obligation(&mut text, obligation)?;
                    } else if preflight_ok {
                        text.push_str(&format!("No active obligation with this milestone ID appears in the supplied view. The supported acknowledgment can establish the agreed compensation; omitted history may exist.\nExact signed due-condition text: {}\n", json(&a.payments.due_conditions)?));
                        text.push_str("Recognizing the amount does not establish fulfillment of narrative payment conditions.\n");
                    } else {
                        text.push_str("Whether this obligation is already established is unverified. Compatible repeated acknowledgments do not add the milestone price again.\n");
                    }
                } else {
                    text.push_str("The exact matching Agreement has no such milestone; no compensation amount is inferred.\n");
                }
            } else {
                text.push_str("Compensation is not confirmed: the exact referenced Agreement or required preflight is unavailable. No other Agreement or root price is substituted.\n");
            }
            completion_evidence(&mut text, report, completion_event_hash)?;
        }
        Action::PaymentReceipt { obligation_id, amount: stated, .. } => {
            text.push_str("\nPAYEE RECEIPT — EXACT UNIT GRANT\n");
            text.push_str(&format!("The unsigned receipt states receipt of: {}\nNamed obligation: {}\nExact proposed allocations: {}\n", amount(stated)?, json(obligation_id)?, json(&proposal.allocations)?));
            text.push_str("Only the actual payee may authorize this receipt. It grants credit over its exact valid allocated units; it does not move funds or independently verify bank settlement.\n");
            if preflight_ok && let Some(obligation) = report.and_then(|r| r.obligations.iter().find(|o| &o.id == obligation_id)) {
                let coverage = rights::allocation_amount(obligation, &proposal.allocations)?;
                let excess = stated.validate()?.checked_sub(coverage).ok_or("REVIEW_ALLOCATION: allocation exceeds stated receipt amount")?;
                text.push_str(&format!("Allocated coverage checked by core: {} minor units\nStated amount not allocated to this obligation: {excess} minor units\n", coverage));
                if report.and_then(|r| r.action_status.get(&proposal_id)).is_some_and(|s| s == "APPLIED") {
                    text.push_str("This exact receipt certificate is already applied; repeating it creates no additional credit and cannot restore its revoked units.\n");
                }
                existing_obligation(&mut text, obligation)?;
                existing_grants(&mut text, obligation)?;
            } else {
                text.push_str("No authenticated allocation coverage, overlap or excess calculation is presented: successful core preflight and an active verified obligation are required. Conditional alternatives are not selected or combined here.\n");
            }
        }
        Action::BilateralSettlement { releases, reservation_of_other_rights, .. } => {
            text.push_str("\nSCOPED R/O SETTLEMENT\n");
            text.push_str("This proposes release only of the identified, supported R/O claims and exact allocated units. It does not change Non Verba's separate fee or service obligations and does not release unrelated claims. R and O must each authorize the same proposal.\n");
            text.push_str(&format!("Exact proposed allocations: {}\nExact reservation text: {}\n", json(&proposal.allocations)?, json(reservation_of_other_rights)?));
            for release in releases {
                text.push_str(&format!("Requested release: {} of obligation {}\n", amount(&release.amount)?, json(&release.obligation_id)?));
                if preflight_ok && let Some(obligation) = report.and_then(|r| r.obligations.iter().find(|o| o.id == release.obligation_id)) {
                    let allocations: Vec<_> = proposal.allocations.iter().filter(|a| a.obligation_id == release.obligation_id).cloned().collect();
                    text.push_str(&format!("Release coverage checked by core: {} minor units\n", rights::allocation_amount(obligation, &allocations)?));
                    existing_obligation(&mut text, obligation)?;
                    existing_grants(&mut text, obligation)?;
                } else {
                    text.push_str("Release authority and coverage are not confirmed; no resulting balance is inferred.\n");
                }
            }
        }
        _ => text.push_str("The exact proposed action, scope and required authorizations remain below. This explanation adds no authority beyond the core's supported rule.\n"),
    }
    Ok(text)
}

fn event_consequences(event: &EventEnvelope) -> Result<String, String> {
    let mut text = format!(
        "Unsigned event author role: {}\nReferenced Agreement: {}\n",
        json(&event.author_role)?,
        json(&event.agreement_hash)?
    );
    match &event.body {
        EventBody::ReceiptAcknowledgment { event_hash } => {
            text.push_str("\nMESSAGE/FILE RECEIPT ONLY\n");
            text.push_str(&format!("Acknowledges receipt of the identified event: {}\n", json(event_hash)?));
            text.push_str("This is not milestone acceptance. It does not establish compensation, grant payment credit, or release a claim. Receipt of content is distinct from agreeing with its substance.\n");
        }
        EventBody::PayerStatement { obligation_id, amount: stated, .. } => {
            text.push_str("\nPAYER OBSERVATION ONLY\n");
            text.push_str(&format!("The payer's statement names {} for obligation {}.\n", amount(stated)?, json(obligation_id)?));
            text.push_str("This is an attributed payment claim, not a payee receipt. It grants no discharge or release and leaves the protocol balance unchanged. It does not move funds or verify bank settlement.\n");
        }
        EventBody::CompletionClaim { milestone_id, .. } => {
            text.push_str(&format!("\nCOMPLETION CLAIM ONLY\nMilestone: {}\n", json(milestone_id)?));
            text.push_str("The completion statement alone does not establish compensation or prove physical performance. A supported acknowledgment or pre-agreed artifact rule requires its own authorization and proof.\n");
        }
        _ => text.push_str("This proposes an attributed event. Its exact body and supported consequences remain distinct from a contractual action; no new financial effect is inferred by this display.\n"),
    }
    Ok(text)
}

impl Review {
    pub fn new(kind: &str, value: Value, context: Option<Value>) -> Result<Self, String> {
        let (exact_content, retained_context) = match kind {
            "request" => (typed::<Request>(value)?, None),
            "quote" => (
                typed::<Quote>(value)?,
                Some(typed::<SignedRequest>(
                    context.ok_or("REVIEW_CONTEXT: signed Request required")?,
                )?),
            ),
            "agreement" => {
                let bundle: AssignmentBundle =
                    serde_json::from_value(value).map_err(|e| format!("REVIEW_SCHEMA: {e}"))?;
                (
                    serde_json::to_value(&bundle.agreement.agreement).map_err(|e| e.to_string())?,
                    Some(serde_json::to_value(bundle).map_err(|e| e.to_string())?),
                )
            }
            "action" => (
                typed::<ActionProposal>(value)?,
                Some(typed::<AssignmentBundle>(
                    context.ok_or("REVIEW_CONTEXT: local bundle required")?,
                )?),
            ),
            "event" => (
                typed::<EventEnvelope>(value)?,
                Some(typed::<AssignmentBundle>(
                    context.ok_or("REVIEW_CONTEXT: local bundle required")?,
                )?),
            ),
            _ => {
                return Err(
                    "REVIEW_KIND: request, quote, agreement, action or event required".into(),
                );
            }
        };
        Ok(Self {
            adapter_version: "1".into(),
            kind: kind.into(),
            content_hash: encoding::digest(&exact_content)?,
            exact_content,
            context_hash: retained_context
                .as_ref()
                .map(encoding::digest)
                .transpose()?,
            retained_context,
        })
    }

    pub fn validate(&self, approved_digest: &str) -> Result<(), String> {
        if self.adapter_version != "1" {
            return Err("REVIEW_VERSION: unsupported adapter review format".into());
        }
        encoding::validate_digest(approved_digest)?;
        if encoding::digest(&self.exact_content)? != self.content_hash
            || approved_digest != self.content_hash
        {
            return Err("CONSENT_DIGEST: retained exact content differs from the participant-reviewed digest".into());
        }
        if self
            .retained_context
            .as_ref()
            .map(encoding::digest)
            .transpose()?
            != self.context_hash
        {
            return Err("CONSENT_CONTEXT: retained context was changed after preview".into());
        }
        let rebuilt = if self.kind == "agreement" {
            let context = self
                .retained_context
                .clone()
                .ok_or("REVIEW_CONTEXT: Agreement bundle required")?;
            let rebuilt = Self::new(&self.kind, context, None)?;
            if rebuilt.content_hash != self.content_hash {
                return Err(
                    "CONSENT_CONTEXT: Agreement in retained bundle differs from signed content"
                        .into(),
                );
            }
            rebuilt
        } else {
            Self::new(
                &self.kind,
                self.exact_content.clone(),
                self.retained_context.clone(),
            )?
        };
        if rebuilt.content_hash != self.content_hash || rebuilt.context_hash != self.context_hash {
            return Err(
                "CONSENT_CONTEXT: typed review differs from retained representation".into(),
            );
        }
        Ok(())
    }

    pub fn render(&self) -> Result<String, String> {
        self.render_with_trust(None)
    }

    /// Display core findings only against independently supplied participant trust.
    pub fn render_verified(&self, trust: &TrustConfiguration) -> Result<String, String> {
        nonverba_requests::agreement::validate_trust(trust)?;
        self.render_with_trust(Some(trust))
    }

    fn render_with_trust(&self, trust: Option<&TrustConfiguration>) -> Result<String, String> {
        self.validate(&self.content_hash)?;
        let mut text = format!(
            "SYNTHETIC DEVELOPMENT — EXACT SIGNING REVIEW\nRecord type: {}\nDigest to authorize: {}\nNo signature has been made by displaying this review.\n\n",
            self.kind, self.content_hash
        );
        text.push_str("SIGNING CONSEQUENCES\nExplanations describe this exact reviewed object; they are not separate terms, signatures or waivers.\n");
        if matches!(self.kind.as_str(), "agreement" | "action" | "event") {
            let input: AssignmentBundle = serde_json::from_value(
                self.retained_context
                    .clone()
                    .ok_or("REVIEW_CONTEXT: retained bundle required")?,
            )
            .map_err(|e| format!("REVIEW_SCHEMA: {e}"))?;
            let report = trust
                .map(|t| bundle::verify_assignment_bundle(&input, t))
                .transpose()?;
            if let Some(report) = &report {
                text.push_str(&format!(
                    "Supplied Agreement certificate complete: {}\nValid Agreement signer roles: {}\nFinancial projection: {}\nFindings describe only the supplied local history; omitted records may exist.\n",
                    report.agreement.bound, json(&report.agreement.valid_signers)?, json(&report.financial_projection)?,
                ));
                if !report.agreement.bound {
                    text.push_str("FORMATION INCOMPLETE: all three valid R/O/M signatures on one exact Agreement are required. Displaying this review supplies no missing consent.\n");
                }
            } else {
                text.push_str("UNAUTHENTICATED DRAFT DESCRIPTION: no independent trust supplied. Signature validity, existing obligations and evidence integrity have not been verified.\n");
            }
            match self.kind.as_str() {
                "action" => {
                    let proposal: ActionProposal = serde_json::from_value(self.exact_content.clone()).map_err(|e| format!("REVIEW_SCHEMA: {e}"))?;
                    text.push_str(&action_consequences(&proposal, &input, report.as_ref(), trust)?);
                }
                "event" => {
                    let envelope: EventEnvelope = serde_json::from_value(self.exact_content.clone()).map_err(|e| format!("REVIEW_SCHEMA: {e}"))?;
                    text.push_str(&event_consequences(&envelope)?);
                    text.push_str("The proposed event is not signed yet. Context findings do not authenticate this new event; role, stream and signing checks still apply.\n");
                }
                _ => text.push_str("Each R/O/M endorsement authorizes the same exact Agreement and its supported rules. It does not certify physical performance, payment capacity, practical readiness or another participant's retention.\n"),
            }
        } else {
            text.push_str("The Request or Quote below is unsigned. Review its exact terms, scope, party and price before authorizing it; viewing this explanation creates no consent.\n");
        }
        text.push('\n');
        if self.kind == "agreement" {
            text.push_str("EXACT SIGNED TERMS AND POLICY (scope, quote, destinations, exclusions and authority)\n");
            text.push_str(
                &serde_json::to_string_pretty(&self.exact_content).map_err(|e| e.to_string())?,
            );
        } else {
            text.push_str(
                "EXACT SIGNED CONTENT (all fields, including scope and authorized consequences)\n",
            );
            text.push_str(
                &serde_json::to_string_pretty(&self.exact_content).map_err(|e| e.to_string())?,
            );
        }
        if let Some(context) = &self.retained_context {
            text.push_str(
                "\n\nRETAINED SIGNING CONTEXT (separate from the signed object's digest)\n",
            );
            text.push_str(&serde_json::to_string_pretty(context).map_err(|e| e.to_string())?);
        }
        text.push_str("\n\nOnly the participant's independently pinned local key can authorize its role.\nSynthetic payment records do not move funds or prove bank settlement.\n");
        Ok(crate::terminal_safe_json(&text))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> Value {
        serde_json::from_str(include_str!(
            "../../../tests/fixtures/lifecycle-bundle.json"
        ))
        .unwrap()
    }

    fn typed_fixture() -> (AssignmentBundle, TrustConfiguration) {
        let input: AssignmentBundle = serde_json::from_value(fixture()).unwrap();
        let trust = TrustConfiguration {
            protocol_version: PROTOCOL_VERSION.into(),
            deployment_domain: input.deployment_domain.clone(),
            parties: input.agreement.agreement.parties.clone(),
        };
        (input, trust)
    }

    fn action_review(proposal: &ActionProposal, input: &AssignmentBundle) -> Review {
        Review::new(
            "action",
            serde_json::to_value(proposal).unwrap(),
            Some(serde_json::to_value(input).unwrap()),
        )
        .unwrap()
    }

    fn consequence_text(text: &str) -> &str {
        text.split("EXACT SIGNED CONTENT").next().unwrap()
    }

    #[test]
    fn verified_ack_explains_duplicate_amount_and_separates_missing_or_invalid_evidence() {
        let (mut input, trust) = typed_fixture();
        let proposal = input
            .actions
            .iter()
            .find(|c| matches!(c.proposal.action, Action::AcknowledgeCompletion { .. }))
            .unwrap()
            .proposal
            .clone();
        let declared = action_review(&proposal, &input).render().unwrap();
        assert!(consequence_text(&declared).contains("UNAUTHENTICATED"));
        assert!(!consequence_text(&declared).contains("EXISTING VERIFIED OBLIGATION"));

        let valid_attachment = input.attachments[0].clone();
        for malformed in [false, true] {
            input.attachments = if malformed {
                vec![Attachment {
                    sha256: valid_attachment.sha256.clone(),
                    bytes_b64: "AA".into(),
                }]
            } else {
                vec![]
            };
            let review = action_review(&proposal, &input);
            let full = review.render_verified(&trust).unwrap();
            let text = consequence_text(&full);
            assert!(text.contains("REQUESTER MILESTONE ACKNOWLEDGMENT"));
            assert!(text.contains("EUR 100.00 (10000 minor units; exponent 2)"));
            assert!(text.contains("already established"));
            assert!(text.contains("does not create an additional charge"));
            assert!(text.contains("not merely acknowledgment that a message or file arrived"));
            assert!(text.contains(if malformed {
                "SUPPLIED_INVALID"
            } else {
                "MISSING"
            }));
            assert!(text.contains("adds no unstated release of remedies"));
            assert!(text.contains("every payment condition has occurred"));
            assert!(full.contains(&review.content_hash));
            assert!(full.contains("EXACT SIGNED CONTENT"));
        }
    }

    #[test]
    fn receipt_review_separates_statement_coverage_excess_and_existing_grants() {
        let (input, trust) = typed_fixture();
        let mut proposal = input
            .actions
            .iter()
            .find(|c| matches!(c.proposal.action, Action::PaymentReceipt { .. }))
            .unwrap()
            .proposal
            .clone();
        let Action::PaymentReceipt {
            payment_id, amount, ..
        } = &mut proposal.action
        else {
            unreachable!()
        };
        *payment_id = "review-overlap-receipt".into();
        *amount = Money::new("4000", "EUR").unwrap();
        proposal.nonce = "review-overlap".into();
        proposal.scope_id = actions::expected_scope(&proposal, &input.agreement.agreement).unwrap();
        proposal.allocations[0].start = "5000".into();
        proposal.allocations[0].end = "8000".into();
        let reviewed = action_review(&proposal, &input)
            .render_verified(&trust)
            .unwrap();
        let text = consequence_text(&reviewed);
        assert!(text.contains("PAYEE RECEIPT — EXACT UNIT GRANT"));
        assert!(text.contains("EUR 40.00 (4000 minor units; exponent 2)"));
        assert!(text.contains("Allocated coverage checked by core: 3000 minor units"));
        assert!(text.contains("not allocated to this obligation: 1000 minor units"));
        assert!(text.contains("\"start\":\"5000\""));
        assert!(text.contains("\"end\":\"8000\""));
        assert!(text.contains("Existing credit grants"));
        assert!(text.contains("Overlapping units count once"));
        assert!(text.contains("not a prediction of the balance"));
        assert!(text.contains("does not move funds"));
        proposal.allocations[0].end = "10001".into();
        let rejected = action_review(&proposal, &input)
            .render_verified(&trust)
            .unwrap();
        assert!(consequence_text(&rejected).contains("preflight: REJECTED"));
        assert!(!consequence_text(&rejected).contains("Allocated coverage checked by core"));
    }

    #[test]
    fn settlement_review_names_exact_release_without_waiving_other_rights() {
        let (input, trust) = typed_fixture();
        let mut proposal = input
            .actions
            .iter()
            .find(|c| matches!(c.proposal.action, Action::PaymentReceipt { .. }))
            .unwrap()
            .proposal
            .clone();
        proposal.action = Action::BilateralSettlement {
            settlement_id: "review-settlement".into(),
            releases: vec![BalanceRelease {
                obligation_id: "milestone:work".into(),
                amount: Money::new("2500", "EUR").unwrap(),
            }],
            reservation_of_other_rights:
                "Only the named units; all other remedies reserved.\u{001b}\u{202e}".into(),
        };
        proposal.nonce = "review-settlement-nonce".into();
        proposal.scope_id = actions::expected_scope(&proposal, &input.agreement.agreement).unwrap();
        proposal.allocations[0].end = "2500".into();
        let full = action_review(&proposal, &input)
            .render_verified(&trust)
            .unwrap();
        let text = consequence_text(&full);
        assert!(text.contains("SCOPED R/O SETTLEMENT"));
        assert!(text.contains("EUR 25.00 (2500 minor units; exponent 2)"));
        assert!(text.contains("Release coverage checked by core: 2500 minor units"));
        assert!(text.contains("Required role authorizations: [\"R\",\"O\"]"));
        assert!(text.contains("does not change Non Verba's separate fee or service obligations"));
        assert!(text.contains("does not release unrelated claims"));
        assert!(!full.contains('\u{001b}'));
        assert!(!full.contains('\u{202e}'));
    }

    #[test]
    fn message_ack_and_payer_statement_have_no_acceptance_or_credit_effect() {
        let (input, trust) = typed_fixture();
        let mut envelope = input.events[0].envelope.clone();
        for body in [
            EventBody::ReceiptAcknowledgment {
                event_hash: encoding::digest(&envelope).unwrap(),
            },
            EventBody::PayerStatement {
                obligation_id: "milestone:work".into(),
                amount: Money::new("4000", "EUR").unwrap(),
                reference: "synthetic observation".into(),
            },
        ] {
            let payer = matches!(body, EventBody::PayerStatement { .. });
            envelope.body = body;
            let review = Review::new(
                "event",
                serde_json::to_value(&envelope).unwrap(),
                Some(serde_json::to_value(&input).unwrap()),
            )
            .unwrap();
            let full = review.render_verified(&trust).unwrap();
            let text = consequence_text(&full);
            assert!(!text.contains("REQUESTER MILESTONE ACKNOWLEDGMENT"));
            if payer {
                assert!(text.contains("PAYER OBSERVATION ONLY"));
                assert!(text.contains("EUR 40.00"));
                assert!(text.contains("not a payee receipt"));
                assert!(text.contains("leaves the protocol balance unchanged"));
            } else {
                assert!(text.contains("MESSAGE/FILE RECEIPT ONLY"));
                assert!(text.contains("not milestone acceptance"));
                assert!(text.contains("does not establish compensation"));
            }
            assert!(text.contains("proposed event is not signed yet"));
        }
    }

    #[test]
    fn missing_exact_agreement_never_borrows_root_price_and_partial_formation_stays_incomplete() {
        let (mut input, trust) = typed_fixture();
        let mut proposal = input
            .actions
            .iter()
            .find(|c| matches!(c.proposal.action, Action::AcknowledgeCompletion { .. }))
            .unwrap()
            .proposal
            .clone();
        proposal.agreement_hash = "f".repeat(64);
        let review = action_review(&proposal, &input);
        for full in [
            review.render().unwrap(),
            review.render_verified(&trust).unwrap(),
        ] {
            let text = consequence_text(&full);
            assert!(text.contains("No other Agreement or root price is substituted"));
            assert!(!text.contains("EUR 100.00"));
        }
        input.agreement.signatures.pop();
        let review = Review::new("agreement", serde_json::to_value(&input).unwrap(), None).unwrap();
        let text = review.render_verified(&trust).unwrap();
        assert!(text.contains("FORMATION INCOMPLETE"));
        assert!(text.contains("Supplied Agreement certificate complete: false"));
    }

    #[test]
    fn preview_covers_exact_scope_quote_destinations_exclusions_and_policy() {
        let review = Review::new("agreement", fixture(), None).unwrap();
        let text = review.render().unwrap();
        assert!(text.contains(&review.content_hash));
        assert!(text.contains("operator-test-account"));
        assert!(text.contains("EXACT SIGNED TERMS AND POLICY"));
        for field in [
            "service",
            "quote",
            "payments",
            "legal",
            "policy",
            "assurance",
        ] {
            assert_eq!(
                review.exact_content[field],
                fixture()["agreement"]["agreement"][field]
            );
        }
        for path in [
            "/service/description",
            "/service/exclusions/0",
            "/quote/quote/compensation/minor_units",
            "/payments/destination",
            "/legal/artifacts/0/text",
        ] {
            let mut changed = review.clone();
            if let Some(value) = changed.exact_content.pointer_mut(path) {
                *value = Value::String("altered after review".into());
                assert!(
                    changed
                        .validate(&review.content_hash)
                        .unwrap_err()
                        .starts_with("CONSENT_DIGEST")
                );
            } else {
                panic!("test fixture missing exact preview field {path}");
            }
        }
    }

    #[test]
    fn formatting_and_later_source_changes_do_not_rewrite_retained_terms() {
        let mut source = fixture();
        let review = Review::new("agreement", source.clone(), None).unwrap();
        source["agreement"]["agreement"]["service"]["description"] =
            Value::String("later template".into());
        let pretty = serde_json::to_string_pretty(&review).unwrap();
        let restored: Review = serde_json::from_str(&pretty).unwrap();
        restored.validate(&review.content_hash).unwrap();
        assert_eq!(review.render().unwrap(), restored.render().unwrap());
        let mut changed_context = review.clone();
        changed_context.retained_context = Some(source);
        assert!(
            changed_context
                .validate(&review.content_hash)
                .unwrap_err()
                .starts_with("CONSENT_CONTEXT")
        );
    }

    #[test]
    fn changed_action_consequences_or_event_body_cannot_use_prior_consent() {
        let bundle = fixture();
        let action = bundle["actions"][0]["proposal"].clone();
        let review = Review::new("action", action, Some(bundle.clone())).unwrap();
        let mut changed = review.clone();
        changed.exact_content["action"] = serde_json::json!({"type":"changed"});
        assert!(changed.validate(&review.content_hash).is_err());
        let event = Review::new(
            "event",
            bundle["events"][0]["envelope"].clone(),
            Some(bundle),
        )
        .unwrap();
        let mut changed = event.clone();
        changed.exact_content["body"] = serde_json::json!({"type":"changed"});
        assert!(changed.validate(&event.content_hash).is_err());
        let text = event.render().unwrap();
        assert!(text.contains(&event.content_hash));
    }
}
