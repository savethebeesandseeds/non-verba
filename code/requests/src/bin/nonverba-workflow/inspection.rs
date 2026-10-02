// SPDX-License-Identifier: AGPL-3.0-only
//! Readable projection of the core report. No financial state is recomputed here.
use nonverba_requests::{
    model::{AssignmentBundle, BundleReport, Diagnostic, Obligation, UnitAllocation, UnitGrant},
    transcript::{EventBody, EventDiagnostic},
};
use serde::Serialize;

const APPENDIX: &str = "\n=== COMPLETE CORE BUNDLEREPORT JSON ===\n";

/// Render the caller's core verification result without inventing a master status,
/// summing conditional alternatives, or treating absent entries as zero balances.
/// Every data value is JSON-encoded, including strings, to escape terminal controls.
pub fn render(bundle: &AssignmentBundle, report: &BundleReport) -> Result<String, String> {
    let mut out = String::from(
        "NON VERBA - DEVELOPMENT / SYNTHETIC WORKFLOW INSPECTION\n\
         This inspection moves no funds and supplies no real-world performance or bank proof.\n\
         A payee receipt is an attributed acknowledgment, not proof of bank settlement.\n\
         Nonfinancial service activation is an undertaking, not financial coverage.\n\
         This is a projection of the supplied core report, not a single master status.\n\
         Data values are JSON-escaped; money remains exact integer minor units.\n",
    );

    section(&mut out, "SUPPLIED BUNDLE CONTEXT");
    field(&mut out, "Protocol", &bundle.protocol_version)?;
    field(&mut out, "Deployment", &bundle.deployment_domain)?;
    field(
        &mut out,
        "Assignment",
        &bundle.agreement.agreement.assignment_id,
    )?;
    field(&mut out, "Request", &bundle.agreement.agreement.request_id)?;
    field(&mut out, "Requests supplied", &bundle.requests.len())?;
    field(
        &mut out,
        "Action certificates supplied",
        &bundle.actions.len(),
    )?;
    field(&mut out, "Events supplied", &bundle.events.len())?;
    field(&mut out, "Attachments supplied", &bundle.attachments.len())?;

    section(&mut out, "FORMATION AND PROTOCOL RECORD CHECKS");
    field(
        &mut out,
        "Root Agreement hash",
        &report.agreement.agreement_hash,
    )?;
    field(
        &mut out,
        "Current Agreement hash in this view",
        &report.current_agreement_hash,
    )?;
    field(&mut out, "Agreement bound", &report.agreement.bound)?;
    field(
        &mut out,
        "Valid Agreement signers",
        &report.agreement.valid_signers,
    )?;
    out.push_str(if report.ready_to_start {
        "Protocol record checks passed — operational readiness not assessed.\n"
    } else {
        "Protocol record checks not passed — operational readiness not assessed.\n"
    });
    field(
        &mut out,
        "Core ready_to_start (technical record-check flag)",
        &report.ready_to_start,
    )?;
    field(
        &mut out,
        "Protocol record check reasons",
        &report.readiness_reasons,
    )?;
    out.push_str(
        "This flag does not assess site safety, access, materials or safe stopping and must not authorize robot actuation.\n\
         A practical start decision requires a separate operational process.\n\
         Certificate retention is a client responsibility; this flag does not attest durable storage or receipt by other participants.\n\
         Failed checks or an open dispute do not erase independently established financial rights.\n",
    );
    diagnostics(
        &mut out,
        "Formation diagnostics",
        &report.agreement.diagnostics,
    )?;

    section(&mut out, "FINANCIAL PROJECTION");
    field(
        &mut out,
        "Projection reported by core",
        &report.financial_projection,
    )?;
    out.push_str("Active obligations, conditional alternatives and payment observations are separate.\n\
                  This renderer calculates no totals, balances, exchange rates or financial effects.\n");
    if report.financial_projection == "LEGACY_UNRESOLVED" {
        out.push_str("LEGACY: original proofs are retained without a supported aggregate projection.\n\
                      Empty financial lists mean unprojected/unknown, NEVER zero debt or waived rights.\n");
    }

    section(&mut out, "ACTIVE ITEMIZED OBLIGATIONS");
    if report.obligations.is_empty() {
        out.push_str(
            "No active obligation entries are projected. This does not declare zero debt.\n",
        );
    }
    for (index, item) in report.obligations.iter().enumerate() {
        out.push_str(&format!("\nActive obligation {}\n", index + 1));
        obligation(&mut out, item)?;
    }

    section(&mut out, "CONDITIONAL RIGHTS - KEEP EACH PROOF SEPARATE");
    out.push_str(
        "These are conditional proof states, NOT ADDITIVE and NOT active totals.\n\
                  Never sum alternatives or turn an absent projection into zero debt.\n",
    );
    if report.unresolved_rights.is_empty() {
        out.push_str("No conditional-right entries are supplied in this report.\n");
    }
    for (index, right) in report.unresolved_rights.iter().enumerate() {
        out.push_str(&format!("\nConditional proof {}\n", index + 1));
        field(&mut out, "Certificate", &right.certificate_id)?;
        field(&mut out, "Reason", &right.reason)?;
        if right.obligations.is_empty() {
            out.push_str(
                "No numeric obligation projection for this proof; this is not zero debt.\n",
            );
        }
        for item in &right.obligations {
            obligation(&mut out, item)?;
        }
    }
    field(
        &mut out,
        "Unresolved claim references",
        &report.unresolved_claims,
    )?;

    section(&mut out, "RECOGNIZED LEGACY AUTHORIZATIONS");
    if report.recognized_legacy_proofs.is_empty() {
        out.push_str("No legacy proof entries supplied.\n");
    }
    for proof in &report.recognized_legacy_proofs {
        field(&mut out, "Certificate", &proof.certificate_id)?;
        field(&mut out, "Action kind", &proof.action_kind)?;
        field(&mut out, "Original authorizers", &proof.authorizers)?;
        field(
            &mut out,
            "Original action proposal (unreinterpreted)",
            &proof.proposal,
        )?;
    }

    section(&mut out, "PERFORMANCE VIEW");
    field(
        &mut out,
        "Performance reported by core",
        &report.performance,
    )?;
    out.push_str("A completion claim, acceptance and payment are distinct records.\n");
    attributed_claims(&mut out, report, |body| {
        matches!(
            body,
            EventBody::StartClaim
                | EventBody::CompletionClaim { .. }
                | EventBody::RejectionClaim { .. }
                | EventBody::CancellationNotice { .. }
        )
    })?;

    section(&mut out, "PAYMENT OBSERVATIONS");
    out.push_str(
        "Payee acknowledgments do not independently establish actual bank payment or finality.\n",
    );
    if report.payments.is_empty() {
        out.push_str("No payment observations projected; this does not establish that no payment occurred.\n");
    }
    for payment in &report.payments {
        field(&mut out, "Certificate", &payment.certificate_id)?;
        field(&mut out, "Obligation", &payment.obligation_id)?;
        field(&mut out, "Observation kind", &payment.kind)?;
        field(
            &mut out,
            "Observed amount (minor units, currency, exponent)",
            &payment.amount,
        )?;
        field(
            &mut out,
            "Discharged minor units reported",
            &payment.discharged_amount,
        )?;
        field(
            &mut out,
            "Excess minor units reported",
            &payment.excess_amount,
        )?;
        field(
            &mut out,
            "External reference / attributed statement",
            &payment.reference,
        )?;
    }

    attributed_claims(&mut out, report, |body| {
        matches!(
            body,
            EventBody::PayerStatement { .. }
                | EventBody::MediatorPaymentObservation { .. }
                | EventBody::PaymentReversalClaim { .. }
        )
    })?;

    section(&mut out, "MEDIATION VIEW");
    field(&mut out, "Mediation reported by core", &report.mediation)?;
    out.push_str(
        "Mediation is free and proposal-only; an assessment is not authority to change rights.\n",
    );
    attributed_claims(&mut out, report, |body| {
        matches!(
            body,
            EventBody::DisputeOpened { .. } | EventBody::Recommendation { .. }
        )
    })?;
    section(&mut out, "ASSURANCE VIEW");
    field(&mut out, "Assurance reported by core", &report.assurance)?;
    out.push_str("Supported service activation is nonfinancial; it proves neither performance nor coverage.\n");
    attributed_claims(&mut out, report, |body| {
        matches!(
            body,
            EventBody::AssuranceClaim { .. } | EventBody::AssuranceAssessment { .. }
        )
    })?;

    section(&mut out, "ACTION VERDICTS AND APPLIED EFFECT PROOFS");
    for (id, status) in &report.action_status {
        field(&mut out, "Action certificate", id)?;
        field(&mut out, "Core action status", status)?;
    }
    if report.action_status.is_empty() {
        out.push_str("No action verdicts supplied.\n");
    }
    for effect in &report.effects {
        field(
            &mut out,
            "Applied effect certificate",
            &effect.certificate_id,
        )?;
        field(&mut out, "Rule", &effect.rule_id)?;
        field(&mut out, "Authorizers", &effect.authorizers)?;
        field(&mut out, "Affected obligations", &effect.obligation_ids)?;
        field(
            &mut out,
            "Required financial / event / artifact proof references",
            &effect.proof_references,
        )?;
        field(&mut out, "Core explanation", &effect.explanation)?;
    }
    out.push_str("Named effect proofs are distinct from generic contextual references.\n");

    section(&mut out, "EVIDENCE INTEGRITY VIEW");
    out.push_str("Signatures, exact bytes, commitment openings, declared media type and physical truth differ.\n\
                  Missing evidence is not automatic forfeiture of an established right.\n");
    if report.evidence_integrity.is_empty() {
        out.push_str(
            "No evidence-integrity entries supplied; no physical truth conclusion follows.\n",
        );
    }
    for evidence in &report.evidence_integrity {
        field(&mut out, "Evidence event", &evidence.event_hash)?;
        field(&mut out, "Event type", &evidence.event_type)?;
        field(&mut out, "Signature valid", &evidence.signature_valid)?;
        field(&mut out, "Body valid", &evidence.body_valid)?;
        field(&mut out, "Commitment opening", &evidence.commitment_opening)?;
        field(&mut out, "Commitment status", &evidence.commitment_status)?;
        field(&mut out, "Transcript status", &evidence.transcript_status)?;
        field(
            &mut out,
            "Manifest digest",
            &evidence.manifest.manifest_digest,
        )?;
        field(
            &mut out,
            "Manifest schema valid",
            &evidence.manifest.schema_valid,
        )?;
        field(
            &mut out,
            "Manifest integrity status",
            &evidence.manifest.status,
        )?;
        for artifact in &evidence.manifest.artifacts {
            field(&mut out, "Artifact digest", &artifact.sha256)?;
            field(
                &mut out,
                "Declared byte length",
                &artifact.declared_byte_length,
            )?;
            field(
                &mut out,
                "Supplied byte length",
                &artifact.actual_byte_length,
            )?;
            field(&mut out, "Availability", &artifact.availability)?;
            field(&mut out, "Digest matches", &artifact.digest_match)?;
            field(&mut out, "Length matches", &artifact.length_match)?;
            field(&mut out, "Declared media type", &artifact.media_type)?;
            field(
                &mut out,
                "Media-type assessment",
                &artifact.media_type_status,
            )?;
        }
        diagnostics(
            &mut out,
            "Manifest diagnostics",
            &evidence.manifest.diagnostics,
        )?;
    }

    section(&mut out, "TRANSCRIPT, DELIVERY AND HISTORY");
    field(
        &mut out,
        "History completeness",
        &report.history_completeness,
    )?;
    field(
        &mut out,
        "Transcript completeness unknown",
        &report.transcript.completeness_unknown,
    )?;
    field(
        &mut out,
        "Retained authenticated event count",
        &report.transcript.retained_events.len(),
    )?;
    field(
        &mut out,
        "Causally admitted event count",
        &report.transcript.accepted.len(),
    )?;
    field(
        &mut out,
        "Direct-proof event count",
        &report.transcript.proof_events.len(),
    )?;
    field(
        &mut out,
        "Identical event duplicates",
        &report.transcript.duplicate_count,
    )?;
    for (hash, status) in &report.transcript.event_status {
        field(&mut out, "Event", hash)?;
        field(
            &mut out,
            "Event status / signature / policy / causal completeness",
            status,
        )?;
    }
    event_diagnostics(
        &mut out,
        "Pending contextual/proof records",
        &report.transcript.pending,
    )?;
    event_diagnostics(
        &mut out,
        "Rejected event records",
        &report.transcript.rejected,
    )?;
    event_diagnostics(&mut out, "Transcript warnings", &report.transcript.warnings)?;
    for conflict in &report.transcript.conflicts {
        field(&mut out, "Retained conflict", conflict)?;
    }
    for round in &report.transcript.rounds {
        field(&mut out, "Evidence round", round)?;
    }
    field(
        &mut out,
        "Delivery acknowledgments",
        &report.transcript.delivery_acknowledgments,
    )?;
    out.push_str(
        "Acknowledging delivery means identified bytes were acknowledged, not accepted.\n\
                  A local bundle cannot establish complete or globally latest history.\n",
    );

    section(&mut out, "DIAGNOSTICS AND DECLARED ASSUMPTIONS");
    diagnostics(&mut out, "Core diagnostics", &report.diagnostics)?;
    field(&mut out, "Assumptions", &report.assumptions)?;
    out.push_str("A generated report is not blanket approval of every supplied record.\n\
                  The complete core report follows so no report field is hidden by this presentation.\n");
    out.push_str(APPENDIX);
    out.push_str(&serde_json::to_string_pretty(report).map_err(encoding_error)?);
    out.push('\n');
    Ok(crate::terminal_safe_json(&out))
}

fn encoding_error(error: serde_json::Error) -> String {
    format!("INSPECTION_ENCODING: {error}")
}

fn section(out: &mut String, title: &str) {
    // All titles are literal application text, never data values.
    out.push_str("\n=== ");
    out.push_str(title);
    out.push_str(" ===\n");
}

fn field<T: Serialize + ?Sized>(out: &mut String, label: &str, value: &T) -> Result<(), String> {
    let encoded = serde_json::to_string(value).map_err(encoding_error)?;
    // Labels are literal application text. JSON encoding escapes dynamic controls.
    out.push_str(label);
    out.push_str(": ");
    out.push_str(&encoded);
    out.push('\n');
    Ok(())
}

fn diagnostics(out: &mut String, label: &str, items: &[Diagnostic]) -> Result<(), String> {
    field(out, label, &items.len())?;
    for item in items {
        field(out, "  Code", &item.code)?;
        field(out, "  Subject", &item.subject)?;
        field(out, "  Message", &item.message)?;
    }
    Ok(())
}

fn event_diagnostics(
    out: &mut String,
    label: &str,
    items: &[EventDiagnostic],
) -> Result<(), String> {
    field(out, label, &items.len())?;
    for item in items {
        field(out, "  Event", &item.event_hash)?;
        field(out, "  Code", &item.code)?;
        field(out, "  Message", &item.message)?;
        field(out, "  Missing references", &item.missing_references)?;
    }
    Ok(())
}

fn attributed_claims(
    out: &mut String,
    report: &BundleReport,
    select: fn(&EventBody) -> bool,
) -> Result<(), String> {
    for (hash, event) in &report.transcript.retained_events {
        if select(&event.envelope.body) {
            out.push_str(
                "Retained attributed statement; this alone grants no financial authority.\n",
            );
            field(out, "  Event hash", hash)?;
            field(out, "  Author role", &event.envelope.author_role)?;
            field(out, "  Exact statement", &event.envelope.body)?;
            field(
                out,
                "  Core transcript assessment",
                &report.transcript.event_status.get(hash),
            )?;
        }
    }
    Ok(())
}

fn obligation(out: &mut String, item: &Obligation) -> Result<(), String> {
    field(out, "Obligation", &item.id)?;
    field(out, "Debtor role", &item.debtor)?;
    field(out, "Creditor role", &item.creditor)?;
    field(out, "Category", &item.category)?;
    field(
        out,
        "Recorded principal (minor units, currency, exponent)",
        &item.amount,
    )?;
    out.push_str(
        "Amounts below use the principal's currency/exponent; no decimal conversion or netting.\n",
    );
    field(out, "Disputed minor units", &item.disputed_amount)?;
    field(out, "Discharged minor units", &item.discharged_amount)?;
    field(out, "Released minor units", &item.released_amount)?;
    field(
        out,
        "Credit/release overlap minor units",
        &item.overlap_amount,
    )?;
    field(
        out,
        "Outstanding recorded balance minor units",
        &item.unresolved_balance,
    )?;
    out.push_str(
        "Recorded principal and outstanding balance do not establish that every payment condition has occurred.\n\
         The verifier does not generally interpret narrative due conditions. Check the agreed conditions and the process used to establish their fulfillment.\n",
    );
    field(out, "Retained due-condition text", &item.due_conditions)?;
    field(out, "Immutable Agreement basis", &item.basis_agreement_hash)?;
    field(out, "Supporting certificates", &item.certificate_ids)?;
    grants(out, "Credit grants", &item.credit_grants)?;
    grants(out, "Release grants", &item.release_grants)
}

fn grants(out: &mut String, label: &str, items: &[UnitGrant]) -> Result<(), String> {
    field(out, label, &items.len())?;
    for grant in items {
        field(out, "  Grant certificate", &grant.certificate_id)?;
        allocations(out, "  Granted intervals [start, end)", &grant.allocations)?;
        allocations(
            out,
            "  Explicitly revoked intervals [start, end)",
            &grant.revoked,
        )?;
    }
    Ok(())
}

fn allocations(out: &mut String, label: &str, items: &[UnitAllocation]) -> Result<(), String> {
    field(out, label, &items.len())?;
    for allocation in items {
        field(out, "    Obligation", &allocation.obligation_id)?;
        field(
            out,
            "    Immutable Agreement basis",
            &allocation.basis_agreement_hash,
        )?;
        field(out, "    Start minor unit (inclusive)", &allocation.start)?;
        field(out, "    End minor unit (exclusive)", &allocation.end)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use nonverba_requests::{
        bundle::verify_assignment_bundle, encoding, model::TrustConfiguration,
    };

    fn lifecycle() -> (AssignmentBundle, BundleReport) {
        let bundle = encoding::strict_parse(include_bytes!(
            "../../../tests/fixtures/lifecycle-bundle.json"
        ))
        .unwrap();
        let trust: TrustConfiguration =
            encoding::strict_parse(include_bytes!("../../../tests/fixtures/trust.json")).unwrap();
        let report = verify_assignment_bundle(&bundle, &trust).unwrap();
        (bundle, report)
    }

    #[test]
    fn renders_exact_core_projection_and_lossless_report_appendix() {
        let (bundle, report) = lifecycle();
        let text = render(&bundle, &report).unwrap();
        assert!(text.contains("DEVELOPMENT / SYNTHETIC"));
        assert!(text.contains("FORMATION AND PROTOCOL RECORD CHECKS"));
        assert!(text.contains("PERFORMANCE VIEW"));
        assert!(text.contains("PAYMENT OBSERVATIONS"));
        assert!(text.contains("MEDIATION VIEW"));
        assert!(text.contains("ASSURANCE VIEW"));
        assert!(text.contains("EVIDENCE INTEGRITY VIEW"));
        assert!(
            text.contains(
                "Retained attributed statement; this alone grants no financial authority."
            )
        );
        assert!(text.contains("Required financial / event / artifact proof references:"));
        assert!(text.contains("Explicitly revoked intervals [start, end)"));
        let appendix: serde_json::Value =
            serde_json::from_str(text.split_once(APPENDIX).unwrap().1).unwrap();
        assert_eq!(appendix, serde_json::to_value(&report).unwrap());
        assert_eq!(text, render(&bundle, &report).unwrap());
    }

    #[test]
    fn nv2_active_fee_and_two_conditional_expenses_remain_separate() {
        let bundle: AssignmentBundle = encoding::strict_parse(include_bytes!(
            "../../../tests/fixtures/nv2-01/late-context-extension.json"
        ))
        .unwrap();
        let trust: TrustConfiguration =
            encoding::strict_parse(include_bytes!("../../../tests/fixtures/nv2-01/trust.json"))
                .unwrap();
        let report = verify_assignment_bundle(&bundle, &trust).unwrap();
        assert_eq!(report.obligations.len(), 1);
        assert_eq!(report.obligations[0].amount.minor_units, "500");
        assert_eq!(
            report.obligations[0].creditor,
            nonverba_requests::model::Role::Mediator
        );
        assert_eq!(report.unresolved_rights.len(), 2);
        assert!(!report.ready_to_start);
        let text = render(&bundle, &report).unwrap();
        let human = text.split_once(APPENDIX).unwrap().0;
        assert!(
            human.contains(
                "Protocol record checks not passed — operational readiness not assessed."
            )
        );
        assert!(human.contains("Core ready_to_start (technical record-check flag): false"));
        for reason in &report.readiness_reasons {
            assert!(human.contains(&serde_json::to_string(reason).unwrap()));
        }
        let active = human
            .split_once("=== ACTIVE ITEMIZED OBLIGATIONS ===\n")
            .unwrap()
            .1
            .split_once("=== CONDITIONAL RIGHTS")
            .unwrap()
            .0;
        assert!(active.contains("\"minor_units\":\"500\""));
        assert!(active.contains("Outstanding recorded balance minor units: \"500\""));
        assert!(active.contains("Creditor role: \"M\""));
        assert!(active.contains(
            "Recorded principal and outstanding balance do not establish that every payment condition has occurred."
        ));
        assert!(active.contains(&format!(
            "Retained due-condition text: {}",
            serde_json::to_string(&report.obligations[0].due_conditions).unwrap()
        )));
        assert!(!active.contains("\"minor_units\":\"1500\""));
        let conditional = human
            .split_once("=== CONDITIONAL RIGHTS")
            .unwrap()
            .1
            .split_once("=== RECOGNIZED LEGACY")
            .unwrap()
            .0;
        assert_eq!(conditional.matches("\"minor_units\":\"1500\"").count(), 2);
        assert!(conditional.contains("NOT ADDITIVE"));
        for right in &report.unresolved_rights {
            assert!(conditional.contains(&serde_json::to_string(&right.certificate_id).unwrap()));
            assert!(conditional.contains(&serde_json::to_string(&right.reason).unwrap()));
        }
        let appendix: serde_json::Value =
            serde_json::from_str(text.split_once(APPENDIX).unwrap().1).unwrap();
        assert_eq!(appendix, serde_json::to_value(&report).unwrap());
    }

    #[test]
    fn legacy_absent_aggregate_is_explicitly_unprojected_not_zero_debt() {
        let bundle = encoding::strict_parse(include_bytes!(
            "../../../tests/fixtures/legacy-v1/bundle.json"
        ))
        .unwrap();
        let trust: TrustConfiguration = encoding::strict_parse(include_bytes!(
            "../../../tests/fixtures/legacy-v1/trust.json"
        ))
        .unwrap();
        let report = verify_assignment_bundle(&bundle, &trust).unwrap();
        let text = render(&bundle, &report).unwrap();
        let human = text.split_once(APPENDIX).unwrap().0;
        assert!(human.contains("LEGACY_UNRESOLVED"));
        assert!(human.contains("unprojected/unknown, NEVER zero debt or waived rights"));
        assert!(human.contains(
            "No active obligation entries are projected. This does not declare zero debt."
        ));
        assert!(human.contains("Core ready_to_start (technical record-check flag): false"));
        assert!(!report.recognized_legacy_proofs.is_empty());
        for proof in &report.recognized_legacy_proofs {
            assert!(human.contains(&serde_json::to_string(&proof.certificate_id).unwrap()));
        }
    }

    #[test]
    fn partial_formation_shows_failed_record_checks_without_operational_assurance() {
        let bundle: AssignmentBundle = encoding::strict_parse(include_bytes!(
            "../../../tests/fixtures/integration/partial-bundle.json"
        ))
        .unwrap();
        let trust: TrustConfiguration = encoding::strict_parse(include_bytes!(
            "../../../tests/fixtures/integration/partial-trust.json"
        ))
        .unwrap();
        let report = verify_assignment_bundle(&bundle, &trust).unwrap();
        assert_eq!(report.agreement.valid_signers.len(), 2);
        assert!(!report.agreement.bound);
        assert!(!report.ready_to_start);
        assert!(!report.readiness_reasons.is_empty());
        let text = render(&bundle, &report).unwrap();
        let (human, appendix) = text.split_once(APPENDIX).unwrap();
        assert!(human.contains("Agreement bound: false"));
        assert!(
            human.contains(
                "Protocol record checks not passed — operational readiness not assessed."
            )
        );
        assert!(human.contains("Core ready_to_start (technical record-check flag): false"));
        assert!(!human.contains("Ready to start"));
        for reason in &report.readiness_reasons {
            assert!(human.contains(&serde_json::to_string(reason).unwrap()));
        }
        assert!(human.contains("must not authorize robot actuation"));
        assert!(human.contains("does not attest durable storage or receipt by other participants"));
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(appendix).unwrap(),
            serde_json::to_value(&report).unwrap()
        );
    }

    #[test]
    fn physical_dispute_preserves_principal_without_claiming_operational_or_payment_readiness() {
        let bundle: AssignmentBundle = encoding::strict_parse(include_bytes!(
            "../../../tests/fixtures/integration/physical-bundle.json"
        ))
        .unwrap();
        let trust: TrustConfiguration = encoding::strict_parse(include_bytes!(
            "../../../tests/fixtures/integration/physical-trust.json"
        ))
        .unwrap();
        let report = verify_assignment_bundle(&bundle, &trust).unwrap();
        assert!(report.ready_to_start);
        assert_eq!(report.performance, "DISPUTED");
        assert!(!report.unresolved_claims.is_empty());
        assert_eq!(report.obligations.len(), 1);
        let obligation = &report.obligations[0];
        assert_eq!(obligation.id, "milestone:work");
        assert_eq!(obligation.amount.minor_units, "10000");
        assert_eq!(obligation.disputed_amount, "10000");
        assert_eq!(obligation.unresolved_balance, "10000");
        let text = render(&bundle, &report).unwrap();
        let (human, appendix) = text.split_once(APPENDIX).unwrap();
        assert!(
            human.contains("Protocol record checks passed — operational readiness not assessed.")
        );
        assert!(human.contains("Core ready_to_start (technical record-check flag): true"));
        assert!(!human.contains("Ready to start"));
        assert!(human.contains("does not assess site safety, access, materials or safe stopping"));
        assert!(human.contains("must not authorize robot actuation"));
        assert!(human.contains("does not attest durable storage or receipt by other participants"));
        assert!(human.contains("Performance reported by core: \"DISPUTED\""));
        assert!(human.contains("Recorded principal (minor units, currency, exponent): {\"minor_units\":\"10000\",\"currency\":\"EUR\",\"exponent\":2}"));
        assert!(human.contains("Disputed minor units: \"10000\""));
        assert!(human.contains("Outstanding recorded balance minor units: \"10000\""));
        assert!(human.contains(
            "Recorded principal and outstanding balance do not establish that every payment condition has occurred."
        ));
        assert!(
            human.contains("The verifier does not generally interpret narrative due conditions.")
        );
        assert!(human.contains(&format!(
            "Retained due-condition text: {}",
            serde_json::to_string(&obligation.due_conditions).unwrap()
        )));
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(appendix).unwrap(),
            serde_json::to_value(&report).unwrap()
        );
    }

    #[test]
    fn arbitrary_data_controls_cannot_inject_terminal_lines_or_ansi() {
        let (mut bundle, mut report) = lifecycle();
        let hostile = "unsafe\u{001b}[2J\r\n=== FALSE APPROVAL ===\t\u{0000}\u{009b}31m\u{0085}\u{202a}\u{202b}\u{202c}\u{202d}\u{202e}\u{2066}\u{2067}\u{2068}\u{2069}\u{200e}\u{200f}\u{2028}\u{2029}".to_owned();
        bundle.deployment_domain = hostile.clone();
        report.readiness_reasons.push(hostile.clone());
        report.obligations[0].due_conditions = hostile.clone();
        report.diagnostics.push(Diagnostic {
            code: hostile.clone(),
            subject: hostile.clone(),
            message: hostile.clone(),
        });
        report.history_completeness = hostile.clone();
        let text = render(&bundle, &report).unwrap();
        assert!(!text.contains('\u{001b}'));
        assert!(!text.contains('\r'));
        assert!(!text.contains('\t'));
        assert!(!text.contains('\u{0000}'));
        assert!(!text.chars().any(|ch| matches!(ch as u32,
            0x80..=0x9f | 0x202a..=0x202e | 0x2066..=0x2069 | 0x200e..=0x200f | 0x2028..=0x2029)));
        assert!(!text.lines().any(|line| line == "=== FALSE APPROVAL ==="));
        assert!(text.contains(&crate::terminal_safe_json(
            &serde_json::to_string(&hostile).unwrap()
        )));
        let appendix: BundleReport =
            serde_json::from_str(text.split_once(APPENDIX).unwrap().1).unwrap();
        assert_eq!(appendix.history_completeness, hostile);
    }
}
