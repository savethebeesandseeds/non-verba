//! Cooperation protocol v1: deterministic integer arithmetic for remuneration.
//!
//! [`cooperation_plan`] is a low-level WebAssembly transport. Its result is
//! **provisional**, not authenticated terms: every returned verification check
//! must succeed before its value can be used. Native integrations should use
//! [`execute_json`], which requires a verifier and releases the result only after
//! all checks succeed. Neither API determines legal eligibility or verifies
//! signatures itself. Constructors produce unsigned candidates; quotation and
//! acceptance require locally evaluated or independently authenticated terms.

use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashSet;

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::wasm_bindgen;

/// Largest supported integer; matches exact integers in JavaScript JSON clients.
pub const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
/// Maximum UTF-8 JSON input size. This is a transport resource bound, not quorum.
pub const MAX_INPUT_BYTES: usize = 64 * 1024 * 1024;
/// Maximum number of votes in one complete snapshot, including expired votes.
pub const MAX_VOTES: usize = 100_000;
const HOUR: u128 = 3_600;
const BPS: u128 = 10_000;
const SCOPE_KEYS: [&str; 7] = [
    "agreementId",
    "taskId",
    "taskVersion",
    "jurisdiction",
    "region",
    "counterpartyId",
    "currency",
];

type ProtocolResult<T> = Result<T, String>;

#[derive(Serialize)]
struct VerificationCheck {
    method: &'static str,
    paths: Vec<Vec<Value>>,
}

#[derive(Serialize)]
struct Plan {
    value: Value,
    checks: Vec<VerificationCheck>,
}

/// Build an UNVERIFIED calculation and the complete ordered verification plan.
///
/// The browser adapter must synchronously require exactly `true` for every
/// check, resolving each argument path against the exact immutable input
/// snapshot, before releasing `value`. Missing fields resolve to JSON null.
/// Paths avoid copying signed policy metadata into every vote check. Never
/// treat this function's successful return as authorization.
/// Inputs use JSON safe integers, minor currency units and seconds. Non-scope
/// metadata is retained for authenticators. Unknown scope fields are rejected.
/// Input JSON is limited to [`MAX_INPUT_BYTES`]; snapshots to [`MAX_VOTES`].
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn cooperation_plan(operation: &str, input_json: &str) -> ProtocolResult<String> {
    let plan = calculate(operation, &parse_input(input_json)?)?;
    serde_json::to_string(&plan).map_err(|error| format!("Cannot encode calculation: {error}"))
}

/// Native entry point: validate, calculate, verify, then release the value.
///
/// The caller supplies authoritative verification for every requested method.
/// There is deliberately no permissive default. A verifier receives immutable,
/// full JSON records (including signed metadata and expired ballots), in the
/// same order as the browser adapter. It must return `Ok(true)` for each check;
/// false or an error fails the entire operation without returning its value.
/// Methods are `verifyPolicy`, `verifyBallotSet`, `verifyVote`, `verifyDemand`,
/// `verifyAcceptance`, and `verifyWorkingTime`. Operations that construct
/// unsigned records or quote authenticated terms have no verification checks.
pub fn execute_json<F>(operation: &str, input_json: &str, mut verifier: F) -> ProtocolResult<String>
where
    F: FnMut(&str, &[Value]) -> ProtocolResult<bool>,
{
    let input = parse_input(input_json)?;
    let plan = calculate(operation, &input)?;
    for check in &plan.checks {
        // Materialize one check at a time, avoiding votes * policy-size memory.
        let args: Vec<_> = check
            .paths
            .iter()
            .map(|path| resolve_path(&input, path).cloned())
            .collect::<ProtocolResult<_>>()?;
        let accepted = verifier(check.method, &args)
            .map_err(|error| format!("{} verification failed: {error}", check.method))?;
        require(
            accepted,
            format!("{} must return true after verification", check.method),
        )?;
    }
    serde_json::to_string(&plan.value)
        .map_err(|error| format!("Cannot encode calculation: {error}"))
}

fn parse_input(input: &str) -> ProtocolResult<Value> {
    require(
        input.len() <= MAX_INPUT_BYTES,
        "Input JSON exceeds the 64 MiB limit",
    )?;
    serde_json::from_str(input).map_err(|error| format!("Invalid input JSON: {error}"))
}

fn calculate(operation: &str, input: &Value) -> ProtocolResult<Plan> {
    object(input, "input")?;
    let mut checks = Vec::new();
    let value = match operation {
        "priceForTime" => json!(price_from_values(
            &input["rateMinorPerHour"],
            &input["seconds"]
        )?),
        "prepareVote" => prepare_vote(input)?,
        "evaluateTask" => evaluate_task(input, &mut checks)?,
        "quoteTask" => quote_task(input)?,
        "prepareAcceptance" => prepare_acceptance(input)?,
        "settlementMinimum" => json!(settlement_minimum(input, &mut checks)?),
        _ => return Err(format!("Unknown cooperation operation: {operation}")),
    };
    Ok(Plan { value, checks })
}

fn require(condition: bool, message: impl Into<String>) -> ProtocolResult<()> {
    if condition {
        Ok(())
    } else {
        Err(message.into())
    }
}

fn object(value: &Value, name: &str) -> ProtocolResult<()> {
    require(value.is_object(), format!("{name} must be an object"))
}

fn integer(value: &Value, name: &str, minimum: u64) -> ProtocolResult<u64> {
    value
        .as_u64()
        .filter(|number| *number >= minimum && *number <= MAX_SAFE_INTEGER)
        .ok_or_else(|| format!("{name} must be a safe integer >= {minimum}"))
}

// Match ECMAScript String.trim and UTF-16 length rather than Rust's differing
// Unicode whitespace definition or byte length.
fn js_whitespace(character: char) -> bool {
    matches!(character, '\u{0009}'..='\u{000d}' | '\u{0020}' | '\u{00a0}'
        | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}'
        | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')
}

fn text<'a>(value: &'a Value, name: &str) -> ProtocolResult<&'a str> {
    value
        .as_str()
        .filter(|value| {
            !value.is_empty()
                && value.encode_utf16().count() <= 200
                && value.trim_matches(js_whitespace) == *value
        })
        .ok_or_else(|| {
            format!(
                "{name} must be nonempty text without surrounding whitespace (max 200 characters)"
            )
        })
}

fn safe_number(value: u128) -> ProtocolResult<u64> {
    require(
        value <= u128::from(MAX_SAFE_INTEGER),
        "Calculation exceeds the supported integer range",
    )?;
    Ok(value as u64)
}

fn ceil_divide(numerator: u128, denominator: u128) -> ProtocolResult<u64> {
    // Every product is at most MAX_SAFE_INTEGER squared; the ballot sum is at
    // most MAX_VOTES * MAX_SAFE_INTEGER. Both fit comfortably within u128.
    safe_number(numerator.div_ceil(denominator))
}

fn validate_scope(scope: &Value) -> ProtocolResult<()> {
    object(scope, "scope")?;
    require(
        scope
            .as_object()
            .expect("validated object")
            .keys()
            .all(|key| SCOPE_KEYS.contains(&key.as_str())),
        "Scope contains unknown fields",
    )?;
    for key in SCOPE_KEYS {
        text(&scope[key], &format!("scope.{key}"))?;
    }
    let currency = scope["currency"].as_str().expect("validated text");
    require(
        currency.len() == 3
            && currency
                .bytes()
                .all(|character| character.is_ascii_uppercase()),
        "Currency must be a three-letter uppercase code",
    )
}

fn same_scope(left: &Value, right: &Value) -> bool {
    SCOPE_KEYS.iter().all(|key| left[key] == right[key])
}

fn validate_operator(operator: &Value, currency: &Value) -> ProtocolResult<()> {
    object(operator, "operator")?;
    text(&operator["operatorId"], "operatorId")?;
    integer(&operator["rateMinorPerHour"], "rateMinorPerHour", 1)?;
    require(
        &operator["currency"] == currency,
        "Operator currency does not match the agreement",
    )
}

fn validate_policy(policy: &Value) -> ProtocolResult<()> {
    object(policy, "policy")?;
    text(&policy["policyId"], "policyId")?;
    integer(&policy["version"], "policy.version", 1)?;
    validate_scope(&policy["scope"])?;
    for key in ["validFrom", "demandSensitivityBps", "maxDemandPremiumBps"] {
        integer(&policy[key], key, 0)?;
    }
    for key in [
        "validUntil",
        "baselinePriceMinor",
        "baselineSeconds",
        "decayWindowSeconds",
        "minimumOperators",
        "minimumEffectiveVotes",
        "demandMaxAgeSeconds",
        "quoteLifetimeSeconds",
    ] {
        integer(&policy[key], key, 1)?;
    }
    require(
        number(policy, "validUntil") > number(policy, "validFrom"),
        "Policy validity window is empty",
    )?;
    require(
        number(policy, "minimumOperators") <= MAX_VOTES as u64
            && number(policy, "minimumEffectiveVotes") <= MAX_VOTES as u64,
        "Policy participation thresholds exceed the ballot limit",
    )?;
    require(
        number(policy, "maxDemandPremiumBps") <= BPS as u64,
        "Demand premium cap cannot exceed 100% in v1",
    )
}

// Only call after the containing record's corresponding field is validated.
fn number(record: &Value, key: &str) -> u64 {
    record[key].as_u64().expect("validated integer")
}

fn check(checks: &mut Vec<VerificationCheck>, method: &'static str, paths: Vec<Vec<Value>>) {
    checks.push(VerificationCheck { method, paths });
}

fn field(name: &str) -> Vec<Value> {
    vec![json!(name)]
}

fn resolve_path<'a>(input: &'a Value, path: &[Value]) -> ProtocolResult<&'a Value> {
    let mut value = input;
    for part in path {
        value = match part {
            Value::String(key) => &value[key],
            Value::Number(index) => {
                let index = index
                    .as_u64()
                    .and_then(|index| usize::try_from(index).ok())
                    .ok_or("Invalid verification argument path")?;
                &value[index]
            }
            _ => return Err("Invalid verification argument path".into()),
        };
    }
    Ok(value)
}

/// Round upwards so rounding never underpays a fraction of a minor unit.
/// This pure arithmetic function does not authenticate any input or agreement.
pub fn price_for_time(rate_minor_per_hour: u64, seconds: u64) -> ProtocolResult<u64> {
    integer(&json!(rate_minor_per_hour), "rateMinorPerHour", 1)?;
    integer(&json!(seconds), "seconds", 1)?;
    ceil_divide(u128::from(rate_minor_per_hour) * u128::from(seconds), HOUR)
}

fn price_from_values(rate: &Value, seconds: &Value) -> ProtocolResult<u64> {
    price_for_time(
        integer(rate, "rateMinorPerHour", 1)?,
        integer(seconds, "seconds", 1)?,
    )
}

fn prepare_vote(input: &Value) -> ProtocolResult<Value> {
    let completion = &input["completion"];
    let operator = &input["operator"];
    object(completion, "completion")?;
    validate_scope(&completion["scope"])?;
    validate_operator(operator, &completion["scope"]["currency"])?;
    for key in ["completionId", "assignmentId", "operatorId"] {
        text(&completion[key], key)?;
    }
    integer(&completion["completedAt"], "completedAt", 0)?;
    integer(&completion["workedSeconds"], "workedSeconds", 1)?;
    require(
        completion["operatorId"] == operator["operatorId"],
        "Completion belongs to another operator",
    )?;
    Ok(json!({
        "version": 1,
        "scope": completion["scope"],
        "completionId": completion["completionId"],
        "assignmentId": completion["assignmentId"],
        "operatorId": completion["operatorId"],
        "completedAt": completion["completedAt"],
        "workedSeconds": completion["workedSeconds"],
        "rateMinorPerHour": operator["rateMinorPerHour"],
        "priceMinor": price_from_values(&operator["rateMinorPerHour"], &completion["workedSeconds"])?
    }))
}

fn validate_vote(vote: &Value, policy: &Value, as_of: u64) -> ProtocolResult<()> {
    object(vote, "vote")?;
    require(
        vote["version"].as_u64() == Some(1),
        "Unsupported vote version",
    )?;
    validate_scope(&vote["scope"])?;
    require(
        same_scope(&vote["scope"], &policy["scope"]),
        "Vote scope does not match the policy",
    )?;
    for key in ["completionId", "assignmentId", "operatorId"] {
        text(&vote[key], key)?;
    }
    integer(&vote["completedAt"], "completedAt", 0)?;
    integer(&vote["workedSeconds"], "workedSeconds", 1)?;
    integer(&vote["priceMinor"], "priceMinor", 1)?;
    require(
        number(vote, "completedAt") <= as_of,
        "Vote completion is in the future",
    )?;
    require(
        number(vote, "priceMinor")
            == price_from_values(&vote["rateMinorPerHour"], &vote["workedSeconds"])?,
        "Vote price does not match the signed rate and time",
    )
}

struct WeightedVote<'a> {
    vote: &'a Value,
    weight: u128,
}

fn weighted_median(entries: &[WeightedVote<'_>], key: &str, total: u128) -> ProtocolResult<u64> {
    let mut ordered: Vec<_> = entries.iter().collect();
    ordered.sort_unstable_by_key(|entry| number(entry.vote, key));
    let mut cumulative = 0;
    for entry in ordered {
        cumulative += entry.weight;
        // Strictly greater implements the upper median at an exact half tie.
        if 2 * cumulative > total {
            return Ok(number(entry.vote, key));
        }
    }
    Err("Cannot compute a median without positive weight".into())
}

fn demand_premium(
    policy: &Value,
    demand: &Value,
    as_of: u64,
    checks: &mut Vec<VerificationCheck>,
) -> ProtocolResult<(u64, &'static str)> {
    if demand.is_null() {
        if number(policy, "demandSensitivityBps") > 0 && number(policy, "maxDemandPremiumBps") > 0 {
            check(
                checks,
                "verifyDemand",
                vec![field("demand"), field("policy"), field("asOf")],
            );
        }
        return Ok((0, "missing"));
    }
    object(demand, "demand")?;
    validate_scope(&demand["scope"])?;
    require(
        same_scope(&demand["scope"], &policy["scope"]),
        "Demand scope does not match the policy",
    )?;
    for key in ["measuredAt", "requestedSeconds", "availableSeconds"] {
        integer(&demand[key], key, 0)?;
    }
    integer(&demand["windowSeconds"], "demand.windowSeconds", 1)?;
    let measured_at = number(demand, "measuredAt");
    require(measured_at <= as_of, "Demand measurement is in the future")?;
    check(
        checks,
        "verifyDemand",
        vec![field("demand"), field("policy"), field("asOf")],
    );
    if as_of - measured_at >= number(policy, "demandMaxAgeSeconds") {
        return Ok((0, "stale"));
    }
    let requested = number(demand, "requestedSeconds");
    let available = number(demand, "availableSeconds");
    let sensitivity = number(policy, "demandSensitivityBps");
    let cap = u128::from(number(policy, "maxDemandPremiumBps"));
    let premium = if sensitivity > 0 && requested > available {
        if available == 0 {
            cap
        } else {
            (u128::from(sensitivity) * u128::from(requested - available) / u128::from(available))
                .min(cap)
        }
    } else {
        0
    };
    Ok((safe_number(premium)?, "verified"))
}

fn evaluate_task(input: &Value, checks: &mut Vec<VerificationCheck>) -> ProtocolResult<Value> {
    let policy = &input["policy"];
    let votes_value = &input["votes"];
    let demand = &input["demand"];
    validate_policy(policy)?;
    let as_of = integer(&input["asOf"], "asOf", 0)?;
    require(
        as_of >= number(policy, "validFrom") && as_of < number(policy, "validUntil"),
        "Policy is not active at evaluation time",
    )?;
    let votes = votes_value
        .as_array()
        .filter(|votes| votes.len() <= MAX_VOTES)
        .ok_or_else(|| format!("votes must contain at most {MAX_VOTES} records"))?;
    check(checks, "verifyPolicy", vec![field("policy"), field("asOf")]);
    check(
        checks,
        "verifyBallotSet",
        vec![field("votes"), field("policy"), field("asOf")],
    );
    let mut completion_ids = HashSet::new();
    let mut performances = HashSet::new();
    let mut operators = HashSet::new();
    let mut active = Vec::new();
    let mut total_weight: u128 = 0;
    let decay_window = number(policy, "decayWindowSeconds");
    for (index, vote) in votes.iter().enumerate() {
        validate_vote(vote, policy, as_of)?;
        let completion_id = vote["completionId"].as_str().expect("validated text");
        let assignment_id = vote["assignmentId"].as_str().expect("validated text");
        let operator_id = vote["operatorId"].as_str().expect("validated text");
        require(
            completion_ids.insert(completion_id),
            "Duplicate completionId",
        )?;
        require(
            performances.insert((assignment_id, operator_id)),
            "More than one vote for the same operator performance",
        )?;
        check(
            checks,
            "verifyVote",
            vec![vec![json!("votes"), json!(index)], field("policy")],
        );
        let age = as_of - number(vote, "completedAt");
        if age >= decay_window {
            continue;
        }
        let weight = u128::from(decay_window - age);
        active.push(WeightedVote { vote, weight });
        operators.insert(operator_id);
        total_weight += weight;
    }
    let sufficient = operators.len() as u64 >= number(policy, "minimumOperators")
        && total_weight
            >= u128::from(number(policy, "minimumEffectiveVotes")) * u128::from(decay_window);
    let median_price_minor = if sufficient {
        Some(weighted_median(&active, "priceMinor", total_weight)?)
    } else {
        None
    };
    let expected_seconds = if sufficient {
        weighted_median(&active, "workedSeconds", total_weight)?
    } else {
        number(policy, "baselineSeconds")
    };
    let base_price_minor =
        number(policy, "baselinePriceMinor").max(median_price_minor.unwrap_or(0));
    let (premium_bps, demand_status) = demand_premium(policy, demand, as_of, checks)?;
    let minimum_price_minor = ceil_divide(
        u128::from(base_price_minor) * (BPS + u128::from(premium_bps)),
        BPS,
    )?;
    let mut valid_until = number(policy, "validUntil").min(safe_number(
        u128::from(as_of) + u128::from(number(policy, "quoteLifetimeSeconds")),
    )?);
    if demand_status == "verified" {
        valid_until = valid_until.min(safe_number(
            u128::from(number(demand, "measuredAt"))
                + u128::from(number(policy, "demandMaxAgeSeconds")),
        )?);
    }
    Ok(json!({
        "version": 1,
        "scope": policy["scope"],
        "policyId": policy["policyId"],
        "policyVersion": policy["version"],
        "asOf": as_of,
        "validUntil": valid_until,
        "support": if sufficient { "sufficient" } else { "baseline-fallback" },
        "activeVotes": active.len(),
        "activeOperators": operators.len(),
        "weightNumerator": total_weight.to_string(),
        "weightDenominator": decay_window.to_string(),
        "medianPriceMinor": median_price_minor,
        "basePriceMinor": base_price_minor,
        "expectedSeconds": expected_seconds,
        "premiumBps": premium_bps,
        "demandStatus": demand_status,
        "minimumPriceMinor": minimum_price_minor
    }))
}

fn validate_terms(terms: &Value) -> ProtocolResult<()> {
    object(terms, "terms")?;
    require(
        terms["version"].as_u64() == Some(1),
        "Unsupported terms version",
    )?;
    validate_scope(&terms["scope"])?;
    text(&terms["policyId"], "policyId")?;
    integer(&terms["policyVersion"], "policyVersion", 1)?;
    integer(&terms["asOf"], "asOf", 0)?;
    integer(&terms["validUntil"], "validUntil", 1)?;
    require(
        number(terms, "validUntil") > number(terms, "asOf"),
        "Terms validity window is empty",
    )?;
    integer(&terms["minimumPriceMinor"], "minimumPriceMinor", 1)?;
    integer(&terms["expectedSeconds"], "expectedSeconds", 1)?;
    Ok(())
}

fn quote_task(input: &Value) -> ProtocolResult<Value> {
    let terms = &input["terms"];
    let operator = &input["operator"];
    validate_terms(terms)?;
    validate_operator(operator, &terms["scope"]["currency"])?;
    let at = integer(&input["at"], "at", 0)?;
    require(
        at >= number(terms, "asOf") && at < number(terms, "validUntil"),
        "Terms are not current",
    )?;
    let personal_price =
        price_from_values(&operator["rateMinorPerHour"], &terms["expectedSeconds"])?;
    Ok(json!({
        "operatorId": operator["operatorId"],
        "rateMinorPerHour": operator["rateMinorPerHour"],
        "personalPriceMinor": personal_price,
        "minimumPriceMinor": number(terms, "minimumPriceMinor").max(personal_price),
        "expectedSeconds": terms["expectedSeconds"],
        "terms": terms
    }))
}

fn prepare_acceptance(input: &Value) -> ProtocolResult<Value> {
    text(&input["assignmentId"], "assignmentId")?;
    let price = integer(&input["priceMinor"], "priceMinor", 1)?;
    let quote = quote_task(input)?;
    require(
        price >= number(&quote, "minimumPriceMinor"),
        "Offer is below the applicable minimum",
    )?;
    let terms = &input["terms"];
    let operator = &input["operator"];
    Ok(json!({
        "version": 1,
        "assignmentId": input["assignmentId"],
        "operatorId": operator["operatorId"],
        "scope": terms["scope"],
        "acceptedAt": input["at"],
        "priceMinor": price,
        "expectedSeconds": terms["expectedSeconds"],
        "rateMinorPerHour": operator["rateMinorPerHour"],
        "terms": terms,
        "overrunRule": "proportional-approved-time-v1"
    }))
}

fn settlement_minimum(input: &Value, checks: &mut Vec<VerificationCheck>) -> ProtocolResult<u64> {
    let record = &input["acceptance"];
    object(record, "acceptance")?;
    require(
        record["version"].as_u64() == Some(1),
        "Unsupported acceptance version",
    )?;
    require(
        record["overrunRule"] == "proportional-approved-time-v1",
        "Unsupported overrun rule",
    )?;
    validate_scope(&record["scope"])?;
    validate_terms(&record["terms"])?;
    require(
        same_scope(&record["scope"], &record["terms"]["scope"]),
        "Acceptance scope mismatch",
    )?;
    require(
        record["expectedSeconds"] == record["terms"]["expectedSeconds"],
        "Acceptance time mismatch",
    )?;
    prepare_acceptance(&json!({
        "assignmentId": record["assignmentId"],
        "terms": record["terms"],
        "operator": {
            "operatorId": record["operatorId"],
            "currency": record["scope"]["currency"],
            "rateMinorPerHour": record["rateMinorPerHour"]
        },
        "priceMinor": record["priceMinor"],
        "at": record["acceptedAt"]
    }))?;
    let approved_seconds = integer(&input["approvedSeconds"], "approvedSeconds", 1)?;
    check(checks, "verifyAcceptance", vec![field("acceptance")]);
    check(
        checks,
        "verifyWorkingTime",
        vec![field("acceptance"), field("approvedSeconds")],
    );
    let price = number(record, "priceMinor");
    Ok(price.max(ceil_divide(
        u128::from(price) * u128::from(approved_seconds),
        u128::from(number(record, "expectedSeconds")),
    )?))
}

#[cfg(test)]
mod tests;
