// SPDX-License-Identifier: AGPL-3.0-only
//! Deterministic sensitivity of one retained analysis. A variant is not a new signature.
use crate::{
    binding::{self, SignedDisputeContextV1},
    case::DisputeCaseV1,
    pipeline::{AnalysisPackageV1, DisputeAnalysisV1},
};
use nonverba_requests::{
    encoding,
    model::{Role, TrustConfiguration},
};
use serde::Serialize;
use serde_json::{Value, json};
use std::collections::BTreeSet;

pub const INCLUSION_FORMAT: &str = "nv-dispute-inclusion-v1";
pub const COMPARISON_FORMAT: &str = "nv-counterfactual-comparison-v1";
const NOTICE: &str = "This comparison is not notice, a response, silence, consent, or a settlement. Silence supplies none of those. A variant allocation is not a signed profile.";

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct InclusionV1 {
    pub format: String,
    pub dictionary_id: String,
    pub dictionary_hash: String,
    pub agreement_hash: String,
    pub requester_profile_hash: String,
    pub operator_profile_hash: String,
    pub case_hash: String,
    pub scope: Vec<String>,
    pub authority_mode: String,
    pub settlement_policy_status: String,
    pub financial_authority: &'static str,
    pub note: &'static str,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct DeltaV1 {
    pub path: String,
    pub baseline: String,
    pub variant: String,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ArmV1 {
    pub name: String,
    pub source: String,
    pub consent: String,
    pub change: Option<Value>,
    pub analysis: DisputeAnalysisV1,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct CounterfactualComparisonV1 {
    pub format: String,
    /// DETERMINISTIC_SENSITIVITY rewrites one retained analysis. RETAINED_READINGS diffs separate readings.
    pub kind: String,
    pub backend: String,
    pub inclusion: InclusionV1,
    pub claim_id: String,
    pub attempt_index: usize,
    pub notice: &'static str,
    pub financial_authority: &'static str,
    pub arms: Vec<ArmV1>,
    pub prior_deltas: Vec<DeltaV1>,
    pub fact_deltas: Vec<DeltaV1>,
}

pub struct PriorShift {
    pub role: Role,
    pub from_dimension: String,
    pub to_dimension: String,
    pub points: u16,
}

fn ensure(condition: bool, message: &str) -> Result<(), String> {
    if condition {
        Ok(())
    } else {
        Err(message.into())
    }
}

fn label<T: Serialize>(value: &T) -> Result<String, String> {
    let value = serde_json::to_value(value).map_err(|error| error.to_string())?;
    value
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| "COUNTERFACTUAL_LABEL: expected a string label".into())
}

/// Report the version-1 annex already bound to this case. This creates no signature.
pub fn inclusion(
    case: &DisputeCaseV1,
    context: &SignedDisputeContextV1,
    trust: &TrustConfiguration,
) -> Result<InclusionV1, String> {
    let report = crate::case::inspect_case(case, trust, Some(context), None)?;
    ensure(
        report.analysis_ready && report.diagnostics.is_empty(),
        "INCLUSION: the case and its signed annex must already verify",
    )?;
    ensure(
        case.context_hash.as_deref() == Some(encoding::digest(&context.context)?.as_str()),
        "INCLUSION: case context hash does not match the annex",
    )?;
    let body = &context.context;
    Ok(InclusionV1 {
        format: INCLUSION_FORMAT.into(),
        dictionary_id: body.dictionary.dictionary_id.clone(),
        dictionary_hash: encoding::digest(&body.dictionary)?,
        agreement_hash: body.agreement_hash.clone(),
        requester_profile_hash: encoding::digest(&body.requester_profile.profile)?,
        operator_profile_hash: encoding::digest(&body.operator_profile.profile)?,
        case_hash: report.case_hash,
        scope: case.scope.clone(),
        authority_mode: label(&body.authority_mode)?,
        settlement_policy_status: label(&body.settlement_policy_status)?,
        financial_authority: "NONE",
        note: "This record describes the signed version-1 annex already bound to the case. A later catalog revision must use a new annex and cannot rewrite these profile hashes.",
    })
}

fn allocations<'a>(
    context: &'a SignedDisputeContextV1,
    role: Role,
) -> Result<(&'a [binding::Allocation], &'static str), String> {
    match role {
        Role::Requester => Ok((&context.context.requester_profile.profile.allocations, "R")),
        Role::Operator => Ok((&context.context.operator_profile.profile.allocations, "O")),
        Role::Mediator => Err("COUNTERFACTUAL_ROLE: the Mediator has no preference vector".into()),
    }
}

fn points(allocations: &[binding::Allocation], dimension: &str) -> Result<u16, String> {
    allocations
        .iter()
        .find(|allocation| allocation.dimension_id == dimension)
        .map(|allocation| allocation.points)
        .ok_or_else(|| {
            format!("COUNTERFACTUAL_DIMENSION: {dimension} is not in the signed catalog")
        })
}

fn baseline_analysis(package: &AnalysisPackageV1) -> Result<(usize, DisputeAnalysisV1), String> {
    package
        .attempts
        .iter()
        .enumerate()
        .rev()
        .find_map(|(index, attempt)| {
            attempt
                .analysis
                .as_ref()
                .filter(|analysis| analysis.prior_comparisons.len() == 5)
                .map(|analysis| (index, analysis.clone()))
        })
        .ok_or_else(|| {
            "COUNTERFACTUAL_BASELINE: a retained five-dimension analysis is required".into()
        })
}

fn hypothetical_emphasis(role: &str, dimension: &str, points: u16) -> String {
    format!(
        "{role} hypothetical {points}/100 on {dimension}. Not a signed profile and not an award."
    )
}

fn prior_variant(
    baseline: &DisputeAnalysisV1,
    role: &str,
    shift: &PriorShift,
    from_points: u16,
    to_points: u16,
) -> Result<DisputeAnalysisV1, String> {
    let mut analysis = baseline.clone();
    let mut changed = 0;
    for comparison in &mut analysis.prior_comparisons {
        let points = if comparison.dimension_id == shift.to_dimension {
            to_points.checked_add(shift.points)
        } else if comparison.dimension_id == shift.from_dimension {
            from_points.checked_sub(shift.points)
        } else {
            None
        };
        let Some(points) = points else { continue };
        changed += 1;
        let emphasis = hypothetical_emphasis(role, &comparison.dimension_id, points);
        if shift.role == Role::Requester {
            comparison.requester_emphasis = emphasis;
        } else {
            comparison.operator_emphasis = emphasis;
        }
        comparison.unresolved_tradeoff = "One hypothetical point move. Signed profiles and the other dimensions stay unchanged. No settlement formula.".into();
    }
    ensure(
        changed == 2,
        "COUNTERFACTUAL_PRIOR: both ends of the move must exist once",
    )?;
    Ok(analysis)
}

fn strip(refs: &mut Vec<String>, withheld: &str) -> bool {
    let before = refs.len();
    refs.retain(|reference| reference != withheld);
    refs.len() != before
}

fn fact_variant(baseline: &DisputeAnalysisV1, withheld: &str) -> Result<DisputeAnalysisV1, String> {
    let mut analysis = baseline.clone();
    let mut cited = false;
    for issue in &mut analysis.issues {
        if !strip(&mut issue.evidence_refs, withheld) {
            continue;
        }
        cited = true;
        issue.uncertainties.push(format!(
            "WITHHELD_FOR_COMPARISON: {withheld} is absent in this arm. Absence is not fault, notice, or consent."
        ));
        ensure(
            issue.uncertainties.len() <= 8,
            "COUNTERFACTUAL_BOUNDS: too many uncertainties",
        )?;
    }
    for comparison in &mut analysis.prior_comparisons {
        if strip(&mut comparison.evidence_refs, withheld) {
            cited = true;
            comparison.unresolved_tradeoff = format!(
                "WITHHELD_FOR_COMPARISON: {withheld} is absent in this arm. The signed profiles are unchanged."
            );
        }
    }
    for question in &mut analysis.questions {
        cited |= strip(&mut question.evidence_refs, withheld);
    }
    ensure(
        cited,
        "COUNTERFACTUAL_FACT: the withheld reference is not cited in the baseline",
    )?;
    ensure(
        analysis.unresolved_reasons.len() < 16,
        "COUNTERFACTUAL_BOUNDS: no room for the withhold reason",
    )?;
    analysis.unresolved_reasons.push(format!(
        "WITHHELD_FOR_COMPARISON: {withheld} was removed for this arm only."
    ));
    Ok(analysis)
}

fn field(path: &str, baseline: &str, variant: &str, deltas: &mut Vec<DeltaV1>) {
    if baseline != variant {
        deltas.push(DeltaV1 {
            path: path.into(),
            baseline: baseline.into(),
            variant: variant.into(),
        });
    }
}

fn list(values: &[String]) -> String {
    values.join(",")
}

fn deltas(
    baseline: &DisputeAnalysisV1,
    variant: &DisputeAnalysisV1,
) -> Result<Vec<DeltaV1>, String> {
    let mut found = Vec::new();
    ensure(
        baseline.issues.len() == variant.issues.len()
            && baseline.prior_comparisons.len() == variant.prior_comparisons.len(),
        "COUNTERFACTUAL_SHAPE: a variant cannot add or drop an issue or dimension",
    )?;
    for (before, after) in baseline.issues.iter().zip(&variant.issues) {
        ensure(
            before.id == after.id,
            "COUNTERFACTUAL_SHAPE: issue identity changed",
        )?;
        let path = format!("issues/{}", before.id);
        field(
            &format!("{path}/evidence_refs"),
            &list(&before.evidence_refs),
            &list(&after.evidence_refs),
            &mut found,
        );
        field(
            &format!("{path}/uncertainties"),
            &list(&before.uncertainties),
            &list(&after.uncertainties),
            &mut found,
        );
        field(
            &format!("{path}/description"),
            &before.description,
            &after.description,
            &mut found,
        );
    }
    for (before, after) in baseline
        .prior_comparisons
        .iter()
        .zip(&variant.prior_comparisons)
    {
        ensure(
            before.dimension_id == after.dimension_id,
            "COUNTERFACTUAL_SHAPE: dimension order changed",
        )?;
        let path = format!("prior_comparisons/{}", before.dimension_id);
        field(
            &format!("{path}/requester_emphasis"),
            &before.requester_emphasis,
            &after.requester_emphasis,
            &mut found,
        );
        field(
            &format!("{path}/operator_emphasis"),
            &before.operator_emphasis,
            &after.operator_emphasis,
            &mut found,
        );
        field(
            &format!("{path}/unresolved_tradeoff"),
            &before.unresolved_tradeoff,
            &after.unresolved_tradeoff,
            &mut found,
        );
        field(
            &format!("{path}/evidence_refs"),
            &list(&before.evidence_refs),
            &list(&after.evidence_refs),
            &mut found,
        );
    }
    field(
        "unresolved_reasons",
        &list(&baseline.unresolved_reasons),
        &list(&variant.unresolved_reasons),
        &mut found,
    );
    Ok(found)
}

/// Compare one retained analysis with a single hypothetical point move and one withheld citation.
/// The package, its signatures, and the core financial projection are not modified.
pub fn compare(
    package: &AnalysisPackageV1,
    trust: &TrustConfiguration,
    claim_id: &str,
    shift: PriorShift,
    withheld_ref: &str,
) -> Result<CounterfactualComparisonV1, String> {
    let inspection = crate::pipeline::inspect_package(package, trust)?;
    ensure(
        inspection.analysis_package_valid,
        "COUNTERFACTUAL_PACKAGE: the retained package must verify",
    )?;
    let case = package.cases.last().ok_or("COUNTERFACTUAL_CASE: no case")?;
    encoding::validate_id(claim_id)?;
    encoding::validate_id(withheld_ref)?;
    ensure(
        case.scope.iter().any(|scope| scope == claim_id),
        "COUNTERFACTUAL_CLAIM: the claim must already be in the case scope",
    )?;
    ensure(
        shift.points > 0,
        "COUNTERFACTUAL_PRIOR: the move must change points",
    )?;
    ensure(
        shift.from_dimension != shift.to_dimension,
        "COUNTERFACTUAL_PRIOR: the move needs two dimensions",
    )?;
    let pinned = inclusion(case, &package.context, trust)?;
    ensure(
        pinned.dictionary_id == binding::DICTIONARY_ID,
        "INCLUSION: the working catalog is nv-dispute-priors-5-v1",
    )?;
    let (allocations, role) = allocations(&package.context, shift.role)?;
    let from_points = points(allocations, &shift.from_dimension)?;
    let to_points = points(allocations, &shift.to_dimension)?;
    ensure(
        from_points >= shift.points,
        "COUNTERFACTUAL_PRIOR: the source dimension does not have those points",
    )?;
    ensure(
        to_points
            .checked_add(shift.points)
            .is_some_and(|points| points <= 100),
        "COUNTERFACTUAL_PRIOR: a dimension cannot exceed 100",
    )?;
    let (attempt_index, baseline) = baseline_analysis(package)?;
    let prior = prior_variant(&baseline, role, &shift, from_points, to_points)?;
    let fact = fact_variant(&baseline, withheld_ref)?;
    let prior_deltas = deltas(&baseline, &prior)?;
    let fact_deltas = deltas(&baseline, &fact)?;
    ensure(
        !prior_deltas.is_empty()
            && prior_deltas.iter().all(|delta| {
                delta.path.contains(&format!("/{}", shift.from_dimension))
                    || delta.path.contains(&format!("/{}", shift.to_dimension))
            }),
        "COUNTERFACTUAL_PRIOR: the point move must change only its two dimensions",
    )?;
    ensure(
        !fact_deltas.is_empty()
            && fact_deltas
                .iter()
                .all(|delta| !delta.path.ends_with("_emphasis")),
        "COUNTERFACTUAL_FACT: withholding a citation must not rewrite a declared emphasis",
    )?;
    let after = inclusion(case, &package.context, trust)?;
    ensure(
        after == pinned,
        "INCLUSION: a hypothetical arm must not change the signed inclusion record",
    )?;
    Ok(CounterfactualComparisonV1 {
        format: COMPARISON_FORMAT.into(),
        kind: "DETERMINISTIC_SENSITIVITY".into(),
        backend: "NONE".into(),
        inclusion: pinned,
        claim_id: claim_id.into(),
        attempt_index,
        notice: NOTICE,
        financial_authority: "NONE",
        arms: vec![
            ArmV1 {
                name: "BASELINE".into(),
                source: "RETAINED_ATTEMPT".into(),
                consent: "SIGNED_PROFILES".into(),
                change: None,
                analysis: baseline,
            },
            ArmV1 {
                name: "PRIOR_VARIANT".into(),
                source: "DETERMINISTIC_SENSITIVITY".into(),
                consent: "HYPOTHETICAL_NOT_A_SIGNATURE".into(),
                change: Some(json!({
                    "role": role,
                    "from_dimension": shift.from_dimension,
                    "to_dimension": shift.to_dimension,
                    "points": shift.points,
                    "signed_from_points": from_points,
                    "signed_to_points": to_points,
                })),
                analysis: prior,
            },
            ArmV1 {
                name: "FACT_VARIANT".into(),
                source: "DETERMINISTIC_SENSITIVITY".into(),
                consent: "HYPOTHETICAL_NOT_A_SIGNATURE".into(),
                change: Some(json!({"withheld_ref": withheld_ref})),
                analysis: fact,
            },
        ],
        prior_deltas,
        fact_deltas,
    })
}

pub fn compare_retained_attempts(
    package: &AnalysisPackageV1,
    trust: &TrustConfiguration,
    claim_id: &str,
    baseline_index: usize,
    prior_index: usize,
    fact_index: usize,
) -> Result<CounterfactualComparisonV1, String> {
    let prior = attempt_analysis(package, prior_index)?;
    let fact = attempt_analysis(package, fact_index)?;
    let backend = retained_backend(package, baseline_index, prior_index, fact_index)?;
    compare_readings(
        package,
        trust,
        claim_id,
        baseline_index,
        &prior,
        &fact,
        &backend,
    )
}

fn retained_backend(
    package: &AnalysisPackageV1,
    baseline_index: usize,
    prior_index: usize,
    fact_index: usize,
) -> Result<String, String> {
    let mut kinds = BTreeSet::new();
    for index in [baseline_index, prior_index, fact_index] {
        let attempt = package
            .attempts
            .get(index)
            .ok_or_else(|| format!("COUNTERFACTUAL_ATTEMPT: attempt {index} is missing"))?;
        let mut found = false;
        for stage in &attempt.stages {
            if let Some(kind) = stage
                .completion
                .as_ref()
                .and_then(|value| value.pointer("/provenance/kind"))
                .and_then(Value::as_str)
            {
                kinds.insert(kind.to_owned());
                found = true;
            }
            if let Some(kind) = stage.backend_kind.as_deref() {
                kinds.insert(kind.to_owned());
                found = true;
            }
        }
        if !found {
            return Err(format!(
                "COUNTERFACTUAL_ATTEMPT: attempt {index} has no completion backend"
            ));
        }
    }
    if kinds.len() == 1 {
        Ok(kinds.into_iter().next().expect("one kind"))
    } else {
        Ok("MIXED".into())
    }
}

fn attempt_analysis(
    package: &AnalysisPackageV1,
    index: usize,
) -> Result<DisputeAnalysisV1, String> {
    package
        .attempts
        .get(index)
        .and_then(|attempt| attempt.analysis.clone())
        .filter(|analysis| analysis.prior_comparisons.len() == 5)
        .ok_or_else(|| {
            format!("COUNTERFACTUAL_ATTEMPT: attempt {index} has no five-dimension reading")
        })
}

/// Diff three retained readings. This does not rewrite their text and does not require the prior move to be well behaved.
pub fn compare_readings(
    package: &AnalysisPackageV1,
    trust: &TrustConfiguration,
    claim_id: &str,
    baseline_index: usize,
    prior: &DisputeAnalysisV1,
    fact: &DisputeAnalysisV1,
    backend: &str,
) -> Result<CounterfactualComparisonV1, String> {
    let inspection = crate::pipeline::inspect_package(package, trust)?;
    ensure(
        inspection.analysis_package_valid,
        "COUNTERFACTUAL_PACKAGE: the retained package must verify",
    )?;
    let case = package.cases.last().ok_or("COUNTERFACTUAL_CASE: no case")?;
    encoding::validate_id(claim_id)?;
    ensure(
        case.scope.iter().any(|scope| scope == claim_id),
        "COUNTERFACTUAL_CLAIM: the claim must already be in the case scope",
    )?;
    let pinned = inclusion(case, &package.context, trust)?;
    ensure(
        pinned.dictionary_id == binding::DICTIONARY_ID,
        "INCLUSION: the working catalog is nv-dispute-priors-5-v1",
    )?;
    let baseline = attempt_analysis(package, baseline_index)?;
    let prior_deltas = deltas(&baseline, prior)?;
    let fact_deltas = deltas(&baseline, fact)?;
    let after = inclusion(case, &package.context, trust)?;
    ensure(
        after == pinned,
        "INCLUSION: reading a variant must not change the signed inclusion record",
    )?;
    Ok(CounterfactualComparisonV1 {
        format: COMPARISON_FORMAT.into(),
        kind: "RETAINED_READINGS".into(),
        backend: backend.into(),
        inclusion: pinned,
        claim_id: claim_id.into(),
        attempt_index: baseline_index,
        notice: NOTICE,
        financial_authority: "NONE",
        arms: vec![
            ArmV1 {
                name: "BASELINE".into(),
                source: "RETAINED_READING".into(),
                consent: "SIGNED_PROFILES".into(),
                change: None,
                analysis: baseline,
            },
            ArmV1 {
                name: "PRIOR_VARIANT".into(),
                source: "RETAINED_READING".into(),
                consent: "HYPOTHETICAL_NOT_A_SIGNATURE".into(),
                change: None,
                analysis: prior.clone(),
            },
            ArmV1 {
                name: "FACT_VARIANT".into(),
                source: "RETAINED_READING".into(),
                consent: "HYPOTHETICAL_NOT_A_SIGNATURE".into(),
                change: None,
                analysis: fact.clone(),
            },
        ],
        prior_deltas,
        fact_deltas,
    })
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct CheckV1 {
    pub id: String,
    pub passed: bool,
    pub detail: String,
}

pub struct ExplanationChecks<'a> {
    pub baseline: &'a DisputeAnalysisV1,
    pub prior_move: &'a DisputeAnalysisV1,
    pub withheld: &'a DisputeAnalysisV1,
    pub party_swap: &'a DisputeAnalysisV1,
    pub irrelevant_name: &'a DisputeAnalysisV1,
    pub spilled_prior: &'a DisputeAnalysisV1,
    pub withheld_ref: &'a str,
    pub from_dimension: &'a str,
    pub to_dimension: &'a str,
    pub names: (&'a str, &'a str),
}

fn emphasis_dimensions(deltas: &[DeltaV1]) -> BTreeSet<String> {
    deltas
        .iter()
        .filter(|delta| delta.path.ends_with("_emphasis"))
        .filter_map(|delta| delta.path.split('/').nth(1).map(str::to_owned))
        .collect()
}

fn prose(analysis: &DisputeAnalysisV1) -> String {
    let mut parts = Vec::new();
    for issue in &analysis.issues {
        parts.push(issue.description.clone());
        parts.push(issue.requester_argument.clone());
        parts.push(issue.operator_argument.clone());
        parts.extend(issue.uncertainties.clone());
    }
    for comparison in &analysis.prior_comparisons {
        parts.push(comparison.requester_emphasis.clone());
        parts.push(comparison.operator_emphasis.clone());
        parts.push(comparison.unresolved_tradeoff.clone());
    }
    parts.extend(analysis.unresolved_reasons.clone());
    parts.join("\n")
}

fn normalize(text: &str, names: (&str, &str)) -> String {
    text.replace(names.0, "PARTY").replace(names.1, "PARTY")
}

/// Apply the frozen checks. A failed check is returned; it is not hidden or turned into an error.
pub fn explanation_checks(case: ExplanationChecks<'_>) -> Result<Vec<CheckV1>, String> {
    let prior_deltas = deltas(case.baseline, case.prior_move)?;
    let fact_deltas = deltas(case.baseline, case.withheld)?;
    let spill_deltas = deltas(case.baseline, case.spilled_prior)?;
    let moved = emphasis_dimensions(&prior_deltas);
    let expected = BTreeSet::from([case.from_dimension.to_owned(), case.to_dimension.to_owned()]);
    let spilled = emphasis_dimensions(&spill_deltas);
    let fact_emphasis = fact_deltas
        .iter()
        .any(|delta| delta.path.ends_with("_emphasis"));
    let withheld_absent = case.withheld.issues.iter().all(|issue| {
        !issue
            .evidence_refs
            .iter()
            .any(|reference| reference == case.withheld_ref)
    }) && case.withheld.prior_comparisons.iter().all(|comparison| {
        !comparison
            .evidence_refs
            .iter()
            .any(|reference| reference == case.withheld_ref)
    });
    let mentions_withheld = prose(case.withheld).contains(case.withheld_ref);
    let invented_ref = case.withheld.issues.iter().any(|issue| {
        let baseline = case.baseline.issues.iter().find(|item| item.id == issue.id);
        issue
            .evidence_refs
            .iter()
            .any(|reference| baseline.is_none_or(|item| !item.evidence_refs.contains(reference)))
    });
    let swapped = case
        .baseline
        .prior_comparisons
        .iter()
        .zip(&case.party_swap.prior_comparisons)
        .all(|(before, after)| {
            before.dimension_id == after.dimension_id
                && before.requester_emphasis == after.operator_emphasis
                && before.operator_emphasis == after.requester_emphasis
        })
        && case
            .baseline
            .issues
            .iter()
            .zip(&case.party_swap.issues)
            .all(|(before, after)| {
                before.id == after.id
                    && before.requester_argument == after.operator_argument
                    && before.operator_argument == after.requester_argument
            });
    let name_stable = normalize(&prose(case.baseline), case.names)
        == normalize(&prose(case.irrelevant_name), case.names);
    Ok(vec![
        CheckV1 {
            id: "prior-move-changes-only-its-dimensions".into(),
            passed: moved == expected,
            detail: format!(
                "emphasis changed in {moved:?}; the move is {} and {}",
                case.from_dimension, case.to_dimension
            ),
        },
        CheckV1 {
            id: "withheld-fact-adds-uncertainty-without-a-new-fact".into(),
            passed: !fact_emphasis && withheld_absent && mentions_withheld && !invented_ref,
            detail: format!(
                "emphasis changed: {fact_emphasis}; citation absent: {withheld_absent}; named in the reading: {mentions_withheld}; invented ref: {invented_ref}"
            ),
        },
        CheckV1 {
            id: "party-swap-swaps-attributed-emphasis".into(),
            passed: swapped,
            detail: "Requester and Operator emphasis and issue arguments exchange places.".into(),
        },
        CheckV1 {
            id: "irrelevant-name-leaves-the-explanation-stable".into(),
            passed: name_stable,
            detail: format!(
                "After replacing {} and {}, the explanation matches the baseline.",
                case.names.0, case.names.1
            ),
        },
        CheckV1 {
            id: "spilled-prior-move-fails-the-clean-move-rule".into(),
            passed: spilled == expected,
            detail: format!(
                "This control applies the clean-move rule to a reading that also changes another dimension. Changed emphasis: {spilled:?}. A false result keeps that spill visible."
            ),
        },
    ])
}
