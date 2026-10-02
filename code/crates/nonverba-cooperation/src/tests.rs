// SPDX-License-Identifier: AGPL-3.0-only
use super::*;

const NOW: u64 = 10_000;

fn scope() -> Value {
    json!({
        "agreementId": "agreement-1", "taskId": "photograph", "taskVersion": "1",
        "jurisdiction": "NO", "region": "oslo", "counterpartyId": "requester-1", "currency": "NOK"
    })
}

fn policy() -> Value {
    json!({
        "policyId": "policy-1", "version": 1, "scope": scope(),
        "validFrom": 0, "validUntil": NOW + 10_000,
        "baselinePriceMinor": 100, "baselineSeconds": 600,
        "decayWindowSeconds": 1_000, "minimumOperators": 1, "minimumEffectiveVotes": 1,
        "demandSensitivityBps": 2_000, "maxDemandPremiumBps": 5_000,
        "demandMaxAgeSeconds": 100, "quoteLifetimeSeconds": 300
    })
}

fn operator() -> Value {
    json!({ "operatorId": "alice", "currency": "NOK", "rateMinorPerHour": 3_600 })
}

fn vote(id: &str, seconds: u64, age: u64) -> Value {
    prepare_vote(&json!({
        "completion": {
            "scope": scope(), "completionId": format!("completion-{id}"),
            "assignmentId": format!("assignment-{id}"), "operatorId": "alice",
            "completedAt": NOW - age, "workedSeconds": seconds
        }, "operator": operator()
    }))
    .unwrap()
}

fn evaluation(votes: Vec<Value>) -> Value {
    json!({ "policy": policy(), "votes": votes, "asOf": NOW })
}

fn provisional(operation: &str, input: &Value) -> Value {
    serde_json::from_str(&cooperation_plan(operation, &input.to_string()).unwrap()).unwrap()
}

fn verified_arguments(operation: &str, input: &Value) -> Vec<Value> {
    let mut checks = Vec::new();
    // Synthetic test records only: capture the exact native verifier arguments.
    execute_json(operation, &input.to_string(), |method, args| {
        checks.push(json!({"method": method, "args": args}));
        Ok(true)
    })
    .unwrap();
    checks
}

fn acceptance() -> Value {
    let terms = provisional("evaluateTask", &evaluation(vec![]))["value"].clone();
    prepare_acceptance(&json!({
        "assignmentId": "accepted-1", "terms": terms,
        "operator": operator(), "priceMinor": 601, "at": NOW
    }))
    .unwrap()
}

#[test]
fn monetary_rounding_and_overflow_are_exact() {
    for (rate, seconds, expected) in [
        (1, 1, 1),
        (3_600, 1, 1),
        (3_601, 1, 2),
        (300, 1_800, 150),
        (101, 1_800, 51),
        (MAX_SAFE_INTEGER, 3_600, MAX_SAFE_INTEGER),
    ] {
        assert_eq!(price_for_time(rate, seconds).unwrap(), expected);
    }
    assert!(price_for_time(MAX_SAFE_INTEGER, 3_601)
        .unwrap_err()
        .contains("integer range"));
    assert!(price_for_time(MAX_SAFE_INTEGER + 1, 1)
        .unwrap_err()
        .contains("safe integer"));
    assert!(price_for_time(1, 0).unwrap_err().contains("safe integer"));
}

#[test]
fn json_fields_reject_nonintegers_and_unsafe_numbers() {
    for invalid in [
        "null",
        "true",
        "\"1\"",
        "-1",
        "0",
        "0.5",
        "1.0",
        "9007199254740992",
    ] {
        for field in ["rateMinorPerHour", "seconds"] {
            let mut input = json!({"rateMinorPerHour": 1, "seconds": 1});
            input[field] = serde_json::from_str(invalid).unwrap();
            let error = cooperation_plan("priceForTime", &input.to_string()).unwrap_err();
            assert!(error.contains("safe integer"), "{field}={invalid}: {error}");
        }
    }
    assert!(cooperation_plan("priceForTime", "[]")
        .unwrap_err()
        .contains("input must be an object"));
    assert!(cooperation_plan("priceForTime", "not-json")
        .unwrap_err()
        .contains("Invalid input JSON"));
}

#[test]
fn scope_is_closed_and_all_boundaries_are_checked() {
    let mut input = evaluation(vec![]);
    input["policy"]["scope"]["hiddenClassification"] = json!("other");
    assert!(cooperation_plan("evaluateTask", &input.to_string())
        .unwrap_err()
        .contains("Scope contains unknown"));
    for key in SCOPE_KEYS {
        let mut changed_vote = vote("a", 300, 0);
        changed_vote["scope"][key] = json!(if key == "currency" {
            "EUR"
        } else {
            "different"
        });
        assert!(
            cooperation_plan("evaluateTask", &evaluation(vec![changed_vote]).to_string())
                .unwrap_err()
                .contains("Vote scope does not match")
        );
    }
}

#[test]
fn text_uses_javascript_whitespace_and_utf16_limits() {
    assert!(text(&json!("\u{feff}name"), "name").is_err());
    assert!(text(&json!("name\u{a0}"), "name").is_err());
    assert!(text(&json!("\u{85}name"), "name").is_ok());
    assert!(text(&json!("😀".repeat(100)), "name").is_ok());
    assert!(text(&json!("😀".repeat(101)), "name").is_err());
}

#[test]
fn repeat_performances_have_equal_initial_weight() {
    let result = provisional(
        "evaluateTask",
        &evaluation(vec![
            vote("a", 300, 0),
            vote("b", 300, 0),
            vote("c", 900, 0),
        ]),
    );
    assert_eq!(result["value"]["medianPriceMinor"], 300);
    assert_eq!(result["value"]["activeVotes"], 3);
    assert_eq!(result["value"]["activeOperators"], 1);
    assert_eq!(result["value"]["weightNumerator"], "3000");
}

#[test]
fn decay_and_upper_median_are_order_independent() {
    for (age, median, weight) in [(400, 900, "2200"), (500, 900, "2000"), (501, 300, "1998")] {
        let mut votes = vec![
            vote("fresh", 300, 0),
            vote("old1", 900, age),
            vote("old2", 900, age),
        ];
        for _ in 0..3 {
            let result = provisional("evaluateTask", &evaluation(votes.clone()));
            assert_eq!(result["value"]["medianPriceMinor"], median);
            assert_eq!(result["value"]["expectedSeconds"], median);
            assert_eq!(result["value"]["weightNumerator"], weight);
            votes.rotate_left(1);
        }
    }
}

#[test]
fn large_weight_sums_remain_exact_decimal_strings() {
    let mut input = evaluation(vec![
        vote("a", 300, 0),
        vote("b", 300, 1),
        vote("c", 300, 2),
    ]);
    input["policy"]["decayWindowSeconds"] = json!(MAX_SAFE_INTEGER);
    let result = provisional("evaluateTask", &input);
    assert_eq!(result["value"]["weightNumerator"], "27021597764222970");
    assert_eq!(result["value"]["weightDenominator"], "9007199254740991");
}

#[test]
fn expiry_and_insufficient_support_use_the_agreed_baseline() {
    let result = provisional("evaluateTask", &evaluation(vec![vote("old", 900, 1_000)]));
    assert_eq!(result["value"]["activeVotes"], 0);
    assert_eq!(result["value"]["weightNumerator"], "0");
    assert_eq!(result["value"]["minimumPriceMinor"], 100);
    assert_eq!(result["value"]["expectedSeconds"], 600);
    assert_eq!(result["value"]["medianPriceMinor"], Value::Null);
    let result = provisional("evaluateTask", &evaluation(vec![vote("almost", 900, 999)]));
    assert_eq!(result["value"]["activeVotes"], 1);
    assert_eq!(result["value"]["support"], "baseline-fallback");
}

#[test]
fn duplicates_and_rate_tampering_fail_validation() {
    let first = vote("a", 300, 0);
    assert!(cooperation_plan(
        "evaluateTask",
        &evaluation(vec![first.clone(), first.clone()]).to_string()
    )
    .unwrap_err()
    .contains("Duplicate completionId"));
    let mut repeated = vote("b", 300, 0);
    repeated["assignmentId"] = first["assignmentId"].clone();
    assert!(cooperation_plan(
        "evaluateTask",
        &evaluation(vec![first.clone(), repeated]).to_string()
    )
    .unwrap_err()
    .contains("same operator performance"));
    let mut forged = first;
    forged["priceMinor"] = json!(301);
    assert!(
        cooperation_plan("evaluateTask", &evaluation(vec![forged]).to_string())
            .unwrap_err()
            .contains("signed rate and time")
    );
}

#[test]
fn verification_plan_contains_full_metadata_and_expired_votes_in_order() {
    let mut current = vote("current", 300, 0);
    current["signature"] = json!({"scheme": "test-only", "value": "vote-proof"});
    let expired = vote("expired", 900, 1_000);
    let mut input = evaluation(vec![current.clone(), expired.clone()]);
    input["policy"]["signature"] = json!("policy-proof");
    let result = provisional("evaluateTask", &input);
    assert_eq!(result["checks"][0]["paths"], json!([["policy"], ["asOf"]]));
    assert_eq!(
        result["checks"][1]["paths"],
        json!([["votes"], ["policy"], ["asOf"]])
    );
    assert_eq!(
        result["checks"][2]["paths"],
        json!([["votes", 0], ["policy"]])
    );
    assert_eq!(
        result["checks"][3]["paths"],
        json!([["votes", 1], ["policy"]])
    );
    assert_eq!(
        result["checks"][4]["paths"],
        json!([["demand"], ["policy"], ["asOf"]])
    );
    assert!(result["checks"]
        .as_array()
        .unwrap()
        .iter()
        .all(|check| check.get("args").is_none()));
    let checks = verified_arguments("evaluateTask", &input);
    let methods: Vec<_> = checks
        .iter()
        .map(|check| check["method"].as_str().unwrap())
        .collect();
    assert_eq!(
        methods,
        [
            "verifyPolicy",
            "verifyBallotSet",
            "verifyVote",
            "verifyVote",
            "verifyDemand"
        ]
    );
    assert_eq!(checks[0]["args"], json!([input["policy"], NOW]));
    assert_eq!(
        checks[1]["args"],
        json!([input["votes"], input["policy"], NOW])
    );
    assert_eq!(checks[2]["args"][0], current);
    assert_eq!(checks[3]["args"][0], expired);
    assert_eq!(checks[4]["args"], json!([null, input["policy"], NOW]));
}

#[test]
fn native_execution_refuses_failed_or_unsupported_verification() {
    let input = evaluation(vec![vote("a", 300, 0)]).to_string();
    for rejected in [
        "verifyPolicy",
        "verifyBallotSet",
        "verifyVote",
        "verifyDemand",
    ] {
        let mut visited = Vec::new();
        let result = execute_json("evaluateTask", &input, |method, _args| {
            visited.push(method.to_owned());
            Ok(method != rejected)
        });
        assert!(result.unwrap_err().contains(rejected));
        assert_eq!(visited.last().unwrap(), rejected);
    }
    let error = execute_json("evaluateTask", &input, |method, _args| {
        Err(format!("No verifier installed for {method}"))
    })
    .unwrap_err();
    assert!(error.contains("verifyPolicy verification failed"));
}

#[test]
fn native_execution_releases_only_after_every_check_succeeds() {
    let input = evaluation(vec![vote("a", 300, 0)]);
    let mut verified = Vec::new();
    // Explicit synthetic test trust; production must authenticate these records.
    let result = execute_json("evaluateTask", &input.to_string(), |method, args| {
        assert!(!args.is_empty());
        verified.push(method.to_owned());
        Ok(true)
    })
    .unwrap();
    assert_eq!(
        verified,
        [
            "verifyPolicy",
            "verifyBallotSet",
            "verifyVote",
            "verifyDemand"
        ]
    );
    assert_eq!(
        serde_json::from_str::<Value>(&result).unwrap()["minimumPriceMinor"],
        300
    );
}

#[test]
fn demand_premiums_are_capped_rounded_and_bound_quote_expiry() {
    let mut input = evaluation(vec![]);
    input["policy"]["baselinePriceMinor"] = json!(101);
    input["demand"] = json!({
        "scope": scope(), "measuredAt": NOW, "windowSeconds": 60,
        "requestedSeconds": 3, "availableSeconds": 2, "proof": "demand-proof"
    });
    let result = provisional("evaluateTask", &input);
    assert_eq!(result["value"]["premiumBps"], 1_000);
    assert_eq!(result["value"]["minimumPriceMinor"], 112);
    assert_eq!(result["value"]["validUntil"], NOW + 100);
    assert_eq!(
        verified_arguments("evaluateTask", &input).last().unwrap()["args"][0],
        input["demand"]
    );
    input["demand"]["availableSeconds"] = json!(0);
    assert_eq!(
        provisional("evaluateTask", &input)["value"]["premiumBps"],
        5_000
    );
    input["demand"]["measuredAt"] = json!(NOW - 100);
    let result = provisional("evaluateTask", &input);
    assert_eq!(result["value"]["demandStatus"], "stale");
    assert_eq!(result["value"]["validUntil"], NOW + 300);
}

#[test]
fn quotes_acceptances_and_settlements_preserve_terms_and_signed_metadata() {
    let mut accepted = acceptance();
    accepted["proof"] = json!({"bothParties": ["alice", "requester"]});
    accepted["terms"]["proof"] = json!("authenticated-terms");
    for (seconds, expected) in [
        (300, 601),
        (600, 601),
        (601, 603),
        (900, 902),
        (1_200, 1_202),
    ] {
        let input = json!({"acceptance": accepted, "approvedSeconds": seconds});
        let plan = provisional("settlementMinimum", &input);
        assert_eq!(plan["value"], expected);
        assert_eq!(plan["checks"][0]["paths"], json!([["acceptance"]]));
        assert_eq!(
            plan["checks"][1]["paths"],
            json!([["acceptance"], ["approvedSeconds"]])
        );
        let checks = verified_arguments("settlementMinimum", &input);
        assert_eq!(checks[0]["args"], json!([accepted]));
        assert_eq!(checks[1]["args"], json!([accepted, seconds]));
    }
    let input = json!({"acceptance": accepted, "approvedSeconds": 900}).to_string();
    for denied in ["verifyAcceptance", "verifyWorkingTime"] {
        assert!(execute_json(
            "settlementMinimum",
            &input,
            |method, _| Ok(method != denied)
        )
        .unwrap_err()
        .contains(denied));
    }
}

#[test]
fn unexpected_operations_and_malformed_records_fail_without_panicking() {
    assert!(cooperation_plan("unknown", "{}")
        .unwrap_err()
        .contains("Unknown cooperation operation"));
    for operation in [
        "priceForTime",
        "prepareVote",
        "evaluateTask",
        "quoteTask",
        "prepareAcceptance",
        "settlementMinimum",
    ] {
        for input in ["{}", "null", "[]", "1", "true", "\"input\""] {
            assert!(
                cooperation_plan(operation, input).is_err(),
                "{operation} {input}"
            );
        }
    }
}
