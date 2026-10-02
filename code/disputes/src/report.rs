// SPDX-License-Identifier: AGPL-3.0-only
//! Deterministic participant presentation of independently inspected records.
//! Rendering never signs, runs inference, changes a case, or selects an outcome.
use crate::{
    case::{self, EvidenceAvailabilityV1, EvidenceOriginV1},
    pipeline::{self, AnalysisPackageV1, PackageInspection},
};
use nonverba_requests::{
    encoding,
    model::{Action, BundleReport, Obligation, TrustConfiguration},
    money::Money,
};
use serde::Serialize;

/// Recompute with independently supplied trust; never render an imported verdict.
/// The complete existing inspection follows the summary without schema changes.
pub fn render_analysis_report(
    package: &AnalysisPackageV1,
    trust: &TrustConfiguration,
) -> Result<String, String> {
    let inspection = pipeline::inspect_package(package, trust)?;
    let current = package.cases.last().ok_or("PACKAGE_CASE: no case")?;
    let core: BundleReport = serde_json::from_value(inspection.base_financial_projection.clone())
        .map_err(|e| e.to_string())?;
    let mut out = String::from(
        "NON VERBA — PRIVATE DISPUTE ANALYSIS INSPECTION\n\
         Mode: ANALYSIS_ONLY. Financial authority: NONE. Settlement policy: UNSPECIFIED.\n\
         This report checks records; it does not establish physical truth, sign, pay, or close a dispute.\n\
         Quoted text is supplied content, not report instructions. Source references identify retained records.\n\n\
         CASE AND RECORD STATUS\n",
    );
    field(
        &mut out,
        "Exact supplied case hash",
        &inspection.current_case_hash,
    );
    if inspection.analysis_package_valid {
        field(&mut out, "Case", &current.case_id);
        field(&mut out, "Revision", &current.revision);
        field(&mut out, "Assignment", &current.assignment_id);
        field(&mut out, "Declared scope", &current.scope);
        field(&mut out, "Recorded lifecycle", &inspection.case_lifecycle);
        out.push_str("Package checks passed. Case metadata and execution records are unsigned runner claims; signatures below have their own scope.\n");
    } else {
        out.push_str("INVALID PACKAGE — participant and model summaries withheld; no completion or closure is inferred.\n");
    }
    for diagnostic in &inspection.diagnostics {
        field(&mut out, "Package diagnostic", diagnostic);
    }
    field(&mut out, "Supplied history", &core.history_completeness);
    out.push_str("Only the supplied history was inspected. Missing records, silence, and inactivity establish no consent or forfeiture.\n");

    out.push_str("\nWHAT THE PARTIES SIGNED\n");
    field(
        &mut out,
        "Root Agreement hash",
        &core.agreement.agreement_hash,
    );
    field(&mut out, "Root Agreement formed", &core.agreement.bound);
    field(
        &mut out,
        "Verified root Agreement signers",
        &core.agreement.valid_signers,
    );
    field(
        &mut out,
        "Current core Agreement hash",
        &core.current_agreement_hash,
    );
    for diagnostic in &core.agreement.diagnostics {
        field(&mut out, "Agreement diagnostic", diagnostic);
    }
    if inspection.analysis_package_valid {
        let context = &package.context.context;
        field(
            &mut out,
            "Exact R/O/M-endorsed annex hash",
            &encoding::digest(context)?,
        );
        out.push_str(
            "Annex endorsements accept the analysis context; they do not accept a settlement.\n",
        );
        field(
            &mut out,
            "Analysis settings hash",
            &context.analysis_specification_hash,
        );
        field(&mut out, "Dictionary", &context.dictionary.dictionary_id);
        out.push_str("Priorities describe what each participant wants considered when resolving disagreement. Separate budgets are not payment shares.\n");
        for (role, signed) in [
            ("R", &context.requester_profile),
            ("O", &context.operator_profile),
        ] {
            out.push_str(&format!("{role} independently signed profile:\n"));
            field(
                &mut out,
                "  Profile hash",
                &encoding::digest(&signed.profile)?,
            );
            // Lookup by dimension identity, never assume both parties used the same order.
            for dimension in &context.dictionary.dimensions {
                let allocation = signed
                    .profile
                    .allocations
                    .iter()
                    .find(|a| a.dimension_id == dimension.id)
                    .ok_or("REPORT_PROFILE: verified dimension missing")?;
                out.push_str(&format!(
                    "  {}: {} / {}\n",
                    quote(&dimension.label),
                    allocation.points,
                    context.dictionary.maximum_points
                ));
            }
        }
        render_evidence(&mut out, package, trust)?;
    } else {
        out.push_str("Annex, profiles, evidence and challenges are not summarized as authenticated from an invalid package.\n");
    }

    render_finances(&mut out, &core);
    render_settlements(&mut out, &current.bundle, &core)?;
    render_attempts(&mut out, &inspection, package)?;

    out.push_str("\nCHALLENGES AND NEXT STEPS\n");
    if inspection.analysis_package_valid {
        if package.challenges.is_empty() {
            out.push_str("No signed analysis challenges in this supplied package. This does not establish agreement.\n");
        }
        for challenge in &package.challenges {
            field(
                &mut out,
                "Signed challenge hash",
                &encoding::digest(&challenge.body)?,
            );
            field(&mut out, "  Author", &challenge.body.author_role);
            field(&mut out, "  Kind", &challenge.body.kind);
            field(&mut out, "  Case hash", &challenge.body.case_hash);
            field(&mut out, "  Attempt hash", &challenge.body.attempt_hash);
            field(&mut out, "  Source references", &challenge.body.references);
            out.push_str(&format!(
                "  Attributed challenge: {}\n",
                excerpt(&challenge.body.text)
            ));
        }
        field(
            &mut out,
            "Recorded compute consumption",
            &inspection.consumed,
        );
        field(
            &mut out,
            "Compute budget exhausted",
            &inspection.budget_exhausted,
        );
    } else {
        out.push_str("Inspect the package diagnostics and obtain the exact missing or corrected records before relying on the companion summary.\n");
    }
    out.push_str(
        "Review questions and interpretations against their original sources. A challenge records a contest; it is not an appeal ruling.\n\
         A proposed resolution requires separate exact review and the core's required authorizations. R/O must both authorize a permitted release.\n\
         A release affects its identified claims; it does not move funds or certify closure of the entire case.\n\
         General negotiated case closure and escalation are not implemented. No settlement computation or fallback has been selected.\n\
         Previously accepted deterministic rules keep their own proof requirements; disagreement does not grant Non Verba new authority.\n\
         This report neither chooses a preferred attempt nor treats no outstanding model questions as resolution.\n\n\
         COMPLETE INDEPENDENT INSPECTION\n",
    );
    out.push_str(&escape_format_controls(
        &serde_json::to_string_pretty(&inspection).map_err(|e| e.to_string())?,
    ));
    out.push('\n');
    Ok(out)
}

fn render_evidence(
    out: &mut String,
    package: &AnalysisPackageV1,
    trust: &TrustConfiguration,
) -> Result<(), String> {
    let current = package.cases.last().ok_or("PACKAGE_CASE: no case")?;
    let inspected = case::inspect_case(
        current,
        trust,
        Some(&package.context),
        package.cases.iter().rev().nth(1),
    )?;
    out.push_str("\nATTRIBUTED CLAIMS AND EVIDENCE\nAuthorship and byte integrity do not prove the account true. Extracts and sensor appraisals remain supplied interpretations.\n");
    if current.evidence.is_empty() {
        out.push_str("No evidence items in this case revision. This is not evidence of no work or no dispute.\n");
    }
    for (item, checked) in current.evidence.iter().zip(&inspected.items) {
        field(out, "Source ID", &item.id);
        field(out, "  Original content hash", &item.content_sha256);
        field(out, "  Authenticated author", &checked.authenticated_role);
        field(
            out,
            "  Original bytes verified",
            &checked.original_bytes_verified,
        );
        field(
            out,
            "  Declared shared availability",
            &checked.accessible_to_all_parties,
        );
        out.push_str("  Availability is a checked local manifest claim, not proof of delivery to every party.\n");
        match &item.origin {
            EvidenceOriginV1::Submission { signed } => {
                field(
                    out,
                    "  Signed submission hash",
                    &encoding::digest(&signed.body)?,
                );
                field(out, "  Statement kind", &signed.body.statement_kind);
                if let Some(offer) = &signed.body.party_offer {
                    out.push_str(&format!(
                        "  Party's proposed amount: {} — not an award, debt or payment.\n",
                        amount(&offer.minor_units, offer)
                    ));
                }
            }
            EvidenceOriginV1::CoreEvent { event_hash } => {
                field(out, "  Authenticated event hash", event_hash)
            }
        }
        match &item.availability {
            EvidenceAvailabilityV1::Accessible { bytes_b64 } => {
                let bytes = nonverba_requests::crypto::decode_base64url(
                    bytes_b64,
                    item.byte_length as usize,
                )?;
                if (item.media_type.starts_with("text/") || item.media_type == "application/json")
                    && let Ok(text) = std::str::from_utf8(&bytes)
                {
                    out.push_str(&format!("  Attributed original text: {}\n", excerpt(text)));
                } else {
                    out.push_str(
                        "  Original bytes retained; no text reading of this media is asserted.\n",
                    );
                }
            }
            EvidenceAvailabilityV1::Redacted { reason } => {
                field(out, "  REDACTED — reason", reason)
            }
            EvidenceAvailabilityV1::Omitted { reason } => field(out, "  OMITTED — reason", reason),
            EvidenceAvailabilityV1::Inaccessible { reason } => {
                field(out, "  INACCESSIBLE — reason", reason)
            }
        }
        for extraction in &item.extractions {
            field(out, "  Extraction producer claim", &extraction.producer);
            out.push_str(&format!(
                "  Supplied extraction: {}\n",
                excerpt(&extraction.text)
            ));
        }
        if let Some(appraisal) = &item.submitted_sensor_appraisal {
            field(
                out,
                "  Sensor appraisal producer claim",
                &appraisal.producer,
            );
            out.push_str(&format!(
                "  Supplied sensor appraisal: {}\n",
                excerpt(&appraisal.text)
            ));
        }
    }
    Ok(())
}

fn render_finances(out: &mut String, core: &BundleReport) {
    out.push_str("\nEXISTING OBLIGATIONS — independently verified core\n");
    field(out, "Financial projection", &core.financial_projection);
    out.push_str("Balances below come from the core, never the model. Receipt and release coverage can overlap and are counted once toward reducing the balance.\n");
    if core.obligations.is_empty() {
        out.push_str("No active obligations projected from the supplied records; this does not establish zero debt or resolve conditional claims.\n");
    }
    for obligation in &core.obligations {
        render_obligation(out, obligation);
    }
    out.push_str("Conditional rights are separate alternatives; do not add them together or treat them as active balances.\n");
    for conditional in &core.unresolved_rights {
        field(out, "Conditional certificate", &conditional.certificate_id);
        field(out, "  Reason", &conditional.reason);
        for obligation in &conditional.obligations {
            render_obligation(out, obligation);
        }
    }
    for claim in &core.unresolved_claims {
        field(out, "Unresolved core claim", claim);
    }
    for payment in &core.payments {
        field(out, "Payment record certificate", &payment.certificate_id);
        field(out, "  Kind", &payment.kind);
        field(out, "  Obligation", &payment.obligation_id);
        out.push_str(&format!(
            "  Stated amount: {}\n  Recorded credited units (historical; see current grants above): {}\n  Unallocated excess: {}\n",
            amount(&payment.amount.minor_units, &payment.amount),
            amount(&payment.discharged_amount, &payment.amount),
            amount(&payment.excess_amount, &payment.amount)
        ));
    }
    for diagnostic in &core.diagnostics {
        field(out, "Core diagnostic", diagnostic);
    }
    out.push_str("Payment entries retain their original recorded amounts after reconciliation; current receipt coverage and revoked ranges are shown with each obligation above.\nPayment observations and payee receipts do not prove bank finality. This report transfers no money.\n");
}

fn render_obligation(out: &mut String, obligation: &Obligation) {
    field(out, "Obligation", &obligation.id);
    out.push_str(&format!(
        "  {} owes {} — category {}\n",
        obligation.debtor.code(),
        obligation.creditor.code(),
        quote(&obligation.category)
    ));
    for (label, units) in [
        ("Principal", &obligation.amount.minor_units),
        ("Receipt coverage", &obligation.discharged_amount),
        ("Release coverage", &obligation.released_amount),
        ("Receipt/release overlap", &obligation.overlap_amount),
        ("Disputed amount", &obligation.disputed_amount),
        ("Outstanding", &obligation.unresolved_balance),
    ] {
        out.push_str(&format!(
            "  {label}: {}\n",
            amount(units, &obligation.amount)
        ));
    }
    field(out, "  Due conditions", &obligation.due_conditions);
    field(out, "  Basis Agreement", &obligation.basis_agreement_hash);
    field(
        out,
        "  Entitlement certificates",
        &obligation.certificate_ids,
    );
    for (label, grants) in [
        ("Receipt grant", &obligation.credit_grants),
        ("Release grant", &obligation.release_grants),
    ] {
        for grant in grants {
            field(
                out,
                &format!("  {label} certificate"),
                &grant.certificate_id,
            );
            field(out, "    Exact unit ranges", &grant.allocations);
            field(out, "    Revoked unit ranges", &grant.revoked);
        }
    }
}

fn render_settlements(
    out: &mut String,
    bundle: &nonverba_requests::model::AssignmentBundle,
    core: &BundleReport,
) -> Result<(), String> {
    out.push_str("\nRECORDED SETTLEMENT ACTIONS — not a new signing preview\nOnly the core's applied effects establish a release. Submitted terms alone establish no consequence.\n");
    let mut found = false;
    for certificate in &bundle.actions {
        if let Action::BilateralSettlement {
            settlement_id,
            releases,
            ..
        } = &certificate.proposal.action
        {
            found = true;
            let hash = encoding::digest(&certificate.proposal)?;
            field(out, "Submitted settlement ID", settlement_id);
            field(out, "  Exact proposal hash", &hash);
            field(out, "  Core action status", &core.action_status.get(&hash));
            out.push_str("  Required authorizers: R and O on this exact proposal.\n");
            for release in releases {
                field(
                    out,
                    "  Requested release obligation",
                    &release.obligation_id,
                );
                out.push_str(&format!(
                    "  Requested release amount: {}\n",
                    amount(&release.amount.minor_units, &release.amount)
                ));
            }
            field(
                out,
                "  Submitted unit ranges",
                &certificate.proposal.allocations,
            );
            let effect = core.effects.iter().find(|e| e.certificate_id == hash);
            if let Some(effect) = effect {
                field(out, "  Verified effect authorizers", &effect.authorizers);
                field(out, "  Applied rule", &effect.rule_id);
                field(out, "  Effect proof references", &effect.proof_references);
                field(out, "  Applied effect", &effect.explanation);
            } else {
                out.push_str("  No active release effect established by this record. Check conditional rights and core diagnostics; do not infer consent or a changed balance.\n");
            }
        }
    }
    if !found {
        out.push_str("No settlement actions supplied. An analysis or party offer is not a settlement certificate.\n");
    }
    out.push_str("M's separate rights and unrelated claims remain governed by the core. A scoped release is not generic case closure.\n");
    Ok(())
}

fn render_attempts(
    out: &mut String,
    inspection: &PackageInspection,
    package: &AnalysisPackageV1,
) -> Result<(), String> {
    out.push_str("\nMODEL INTERPRETATIONS AND OPEN QUESTIONS\nA question disposition is a model interpretation, including ANSWERED_FROM_SOURCE, UNNECESSARY and SUPERSEDED. Check its reason and original sources.\n");
    if !inspection.analysis_package_valid {
        out.push_str("Interpretations and question summaries withheld because package checks failed. An empty suppressed list does not mean questions were answered.\n");
        return Ok(());
    }
    if inspection.attempts.is_empty() {
        out.push_str(
            "No retained analysis attempts. No model conclusion or resolution is established.\n",
        );
    }
    for (index, attempt) in inspection.attempts.iter().enumerate() {
        let kind = attempt["execution_kind"].as_str().unwrap_or("UNKNOWN");
        let origin = match kind {
            "MOCK" => "SYNTHETIC MOCK — development output; not a real local-model result",
            "LOCAL_LLAMA_CPP" => {
                "LOCAL LLAMA.CPP — unverified runner claim, not execution attestation"
            }
            "MIXED" => "MIXED EXECUTION ORIGINS — inspect each stage; no single real-local claim",
            _ => "NO COMPLETED EXECUTION ORIGIN — no successful local execution established",
        };
        out.push_str(&format!("\nAttempt {}: {origin}\n", index + 1));
        field(
            out,
            "  Exact attempt hash",
            &encoding::digest(&package.attempts[index])?,
        );
        for (label, key) in [
            ("  Case hash", "case_hash"),
            ("  Seed", "seed"),
            ("  Execution", "execution_status"),
            ("  Displayed analysis status", "analysis_status"),
            ("  Recorded analysis status", "recorded_analysis_status"),
            ("  Stale or cancelled", "stale"),
            (
                "  Eligible as current analysis",
                "eligible_as_current_analysis",
            ),
            ("  Failure or interruption reason", "reason"),
        ] {
            field(out, label, &attempt[key]);
        }
        out.push_str(&format!(
            "Eligible as current real local analysis: {}.\n",
            attempt["eligible_as_real_local_analysis"]
                .as_bool()
                .unwrap_or(false)
        ));
        out.push_str("Execution/structure checks do not assess reasoning quality. Historical and failed attempts remain visible; none is automatically preferred.\n");
        if let Some(issues) = attempt["first_pass_issues"].as_array() {
            for issue in issues {
                field(out, "  Model issue", &issue["description"]);
                field(
                    out,
                    "    Model's reading of R's argument",
                    &issue["requester_argument"],
                );
                field(
                    out,
                    "    Model's reading of O's argument",
                    &issue["operator_argument"],
                );
                field(out, "    Uncertainties", &issue["uncertainties"]);
                field(out, "    Source references", &issue["evidence_refs"]);
            }
        }
        if let Some(comparisons) =
            attempt["validated_interpretation"]["prior_comparisons"].as_array()
        {
            for comparison in comparisons {
                field(
                    out,
                    "  Priority interpreted by model",
                    &comparison["dimension_id"],
                );
                field(
                    out,
                    "    R emphasis interpretation",
                    &comparison["requester_emphasis"],
                );
                field(
                    out,
                    "    O emphasis interpretation",
                    &comparison["operator_emphasis"],
                );
                field(
                    out,
                    "    Unresolved tradeoff",
                    &comparison["unresolved_tradeoff"],
                );
                field(out, "    Source references", &comparison["evidence_refs"]);
            }
        }
        if let Some(account) = attempt["question_account"].as_array() {
            for question in account {
                field(out, "  Question ID", &question["question_id"]);
                field(out, "    To", &question["question"]["addressee"]);
                field(out, "    Question", &question["question"]["text"]);
                field(out, "    Purpose", &question["question"]["purpose"]);
                field(
                    out,
                    "    Original question references",
                    &question["question"]["evidence_refs"],
                );
                field(out, "    Model disposition", &question["status"]);
                field(out, "    Model's reason", &question["reason"]);
                field(
                    out,
                    "    Disposition references",
                    &question["evidence_refs"],
                );
                field(
                    out,
                    "    Superseded by question ID",
                    &question["superseded_by_question_id"],
                );
            }
        }
        let outstanding = attempt["outstanding_questions"]
            .as_array()
            .map_or(0, Vec::len);
        out.push_str(&format!("  Outstanding questions in this attempt's derived account: {outstanding}. This count does not establish factual resolution.\n"));
        if let Some(reasons) = attempt["validated_interpretation"]["unresolved_reasons"].as_array()
        {
            for reason in reasons {
                field(out, "  Model's unresolved reason", reason);
            }
        }
        if let Some(alternatives) = attempt["validated_interpretation"]["alternatives"].as_array() {
            for alternative in alternatives {
                field(
                    out,
                    "  Model-suggested alternative (not an obligation)",
                    alternative,
                );
            }
        }
    }
    Ok(())
}

fn amount(units: &str, money: &Money) -> String {
    if nonverba_requests::money::parse_minor_units(units).is_err() || money.validate().is_err() {
        return format!("UNVALIDATED amount {} in {}", quote(&units), quote(money));
    }
    let exponent = usize::from(money.exponent);
    let padded = format!("{:0>width$}", units, width = exponent + 1);
    let decimal = if exponent == 0 {
        padded
    } else {
        let split = padded.len() - exponent;
        format!("{}.{}", &padded[..split], &padded[split..])
    };
    format!(
        "{} {decimal} ({units} minor units; exponent {})",
        money.currency, money.exponent
    )
}

fn field<T: Serialize + ?Sized>(out: &mut String, label: &str, value: &T) {
    out.push_str(&format!("{label}: {}\n", quote(value)));
}

fn quote<T: Serialize + ?Sized>(value: &T) -> String {
    // All callers use JSON-compatible model fields or a recomputed JSON value.
    escape_format_controls(&serde_json::to_string(value).expect("report fields serialize as JSON"))
}

fn excerpt(text: &str) -> String {
    let excerpt: String = text.chars().take(480).collect();
    if excerpt.len() < text.len() {
        format!(
            "{} [excerpt: first 480 characters; full original remains in the source record]",
            quote(&excerpt)
        )
    } else {
        quote(text)
    }
}

fn escape_format_controls(text: &str) -> String {
    text.chars().map(|c| {
        if ('\u{0080}'..='\u{009f}').contains(&c)
            || matches!(c, '\u{200b}'..='\u{200f}' | '\u{2028}'..='\u{202e}' | '\u{2066}'..='\u{2069}' | '\u{feff}') {
            format!("\\u{:04x}", c as u32)
        } else { c.to_string() }
    }).collect()
}
