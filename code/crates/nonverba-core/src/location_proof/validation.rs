// SPDX-License-Identifier: AGPL-3.0-only
//! The same policy evaluation is used before signing and during verification.
//! All reported clocks and sensor fields remain claims, not attestation.
use super::model::*;

pub const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
pub const MAX_COLLECTION_MS: u64 = 60_000;
pub const MAX_SAMPLES: usize = 128;

pub fn validate_policy(p: &Policy) -> Result<(), String> {
    // An explicitly requested raw trace may use a shorter continuity window.
    // Counts, actual spans, clock uncertainty and all quality checks still apply;
    // two seconds is not a positioning or physical-authenticity guarantee.
    let minimum_duration_ms = if p.raw_gnss.is_some() { 2_000 } else { 5_000 };
    if !matches!(p.profile.as_str(), "browser-or-native" | "native-required")
        || !matches!(p.required_provider.as_str(), "any" | "gnss")
        || !(minimum_duration_ms..=15_000).contains(&p.duration_ms)
        || !(3..=MAX_SAMPLES).contains(&p.min_samples)
        || !p.max_accuracy_m.is_finite()
        || !(0.01..=10_000.0).contains(&p.max_accuracy_m)
        || !(1..=30_000).contains(&p.max_fix_age_ms)
        || !(1..=5_000).contains(&p.max_delivery_delay_ms)
        || p.max_finalization_delay_ms
            .is_some_and(|delay| !(1..=30_000).contains(&delay))
        || !p.max_speed_mps.is_finite()
        || !(0.0..=1_000.0).contains(&p.max_speed_mps)
        || !super::raw_gnss::policy_valid(p)
    {
        return Err("Unsupported or out-of-bounds location policy".into());
    }
    Ok(())
}

pub fn request_shape(request: &Request) -> Result<(), String> {
    if request.version != 1 || request.kind != "nonverba-location-request" {
        return Err("Unsupported location request".into());
    }
    crate::challenge_shape(&request.challenge)?;
    if request.challenge.expires_at > MAX_SAFE_INTEGER / 1000 {
        return Err("Location request time exceeds safe integer milliseconds".into());
    }
    validate_policy(&request.policy)?;
    if let Some(context) = &request.context {
        if context.session_id.trim().is_empty()
            || context.session_id.len() > 200
            || context.purpose.trim().is_empty()
            || context.purpose.len() > 200
        {
            return Err("Location context requires a bounded session ID and purpose".into());
        }
        if context
            .camera_timing
            .as_deref()
            .is_some_and(|timing| timing != "concurrent" || context.purpose != "camera")
        {
            return Err("Concurrent camera timing requires a camera context".into());
        }
    }
    Ok(())
}

pub fn validate_request(request: &Request, now_ms: u64) -> Result<(), String> {
    request_shape(request)?;
    if now_ms > MAX_SAFE_INTEGER
        || now_ms < request.challenge.issued_at * 1000
        || now_ms >= request.challenge.expires_at * 1000
    {
        return Err("Location request is not currently valid".into());
    }
    Ok(())
}

pub fn validate_asset(asset: &AssetBinding) -> Result<(), String> {
    if asset.kind != "image/jpeg" || !canonical_hash(&asset.sha256) {
        return Err("Asset binding must be image/jpeg with a lowercase SHA-256 digest".into());
    }
    Ok(())
}
pub fn canonical_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn finite_sample(s: &Sample) -> bool {
    s.latitude.is_finite()
        && (-90.0..=90.0).contains(&s.latitude)
        && s.longitude.is_finite()
        && (-180.0..=180.0).contains(&s.longitude)
        && s.accuracy_m.is_finite()
        && s.accuracy_m >= 0.0
        && s.altitude_m.is_none_or(f64::is_finite)
        && s.altitude_accuracy_m
            .is_none_or(|a| a.is_finite() && a >= 0.0)
        && (s.altitude_accuracy_m.is_none() || s.altitude_m.is_some())
}

fn distance_m(a: &Sample, b: &Sample) -> f64 {
    let lat = ((b.latitude - a.latitude).to_radians() / 2.0).sin().powi(2);
    let lon = ((b.longitude - a.longitude).to_radians() / 2.0)
        .sin()
        .powi(2);
    let h = lat + a.latitude.to_radians().cos() * b.latitude.to_radians().cos() * lon;
    12_742_000.0 * h.clamp(0.0, 1.0).sqrt().asin()
}

/// Only an explicit original policy separates processing from sample freshness.
/// Collection freshness is checked separately; old requests keep their old rule.
pub(super) fn finalization_within_policy(
    trace: &Trace,
    sealed_at_ms: u64,
    last_fix_ms: u64,
) -> bool {
    match trace.request.policy.max_finalization_delay_ms {
        Some(maximum) => sealed_at_ms.saturating_sub(trace.ended_at_ms) <= maximum,
        None => sealed_at_ms.saturating_sub(last_fix_ms) <= trace.request.policy.max_fix_age_ms,
    }
}

/// Returns granular predicates, including source *claims*. Does not authenticate
/// the OS, satellite signal, receiver, or physical place of capture.
pub(super) fn evaluate(trace: &Trace, sealed_at_ms: u64, now_ms: u64) -> (Checks, Vec<String>) {
    let mut c = Checks::default();
    let p = &trace.request.policy;
    let native = trace.profile == "native-android";
    let browser = trace.profile == "software-browser";
    c.policy_valid = request_shape(&trace.request).is_ok();
    c.source_claim_matches_policy = (native || browser)
        && (p.profile == "browser-or-native" || (p.profile == "native-required" && native))
        && (p.required_provider == "any" || (p.required_provider == "gnss" && native))
        && trace.samples.iter().all(|s| {
            if native {
                matches!(s.provider.as_str(), "gps" | "network" | "fused")
                    && (p.required_provider != "gnss" || s.provider == "gps")
            } else {
                s.provider == "browser-geolocation"
            }
        });
    c.uncertainty_semantics_valid = (native
        && trace.permission_precision == "fine"
        && trace.uncertainty_semantics == "android-68-percent")
        || (browser
            && trace.permission_precision == "browser"
            && trace.uncertainty_semantics == "w3c-95-percent");
    c.sample_count_valid =
        trace.samples.len() >= p.min_samples && trace.samples.len() <= MAX_SAMPLES;
    c.sequence_valid = !trace.samples.is_empty()
        && trace
            .samples
            .iter()
            .enumerate()
            .all(|(i, s)| s.sequence == i)
        && trace.samples.windows(2).all(|s| {
            s[1].observed_elapsed_ms > s[0].observed_elapsed_ms
                && s[1].fix_timestamp_ms > s[0].fix_timestamp_ms
                && (!native
                    || matches!((s[0].fix_elapsed_ms,s[1].fix_elapsed_ms),(Some(a),Some(b)) if b>a))
        });
    let valid_times = trace.started_at_ms <= MAX_SAFE_INTEGER
        && trace.ended_at_ms <= MAX_SAFE_INTEGER
        && sealed_at_ms <= MAX_SAFE_INTEGER
        && now_ms <= MAX_SAFE_INTEGER
        && trace.elapsed_ms <= MAX_COLLECTION_MS
        && trace.ended_at_ms >= trace.started_at_ms;
    c.clock_consistent = valid_times
        && trace
            .ended_at_ms
            .saturating_sub(trace.started_at_ms)
            .abs_diff(trace.elapsed_ms)
            <= 1000
        && trace.samples.iter().all(|s| {
            s.observed_elapsed_ms <= trace.elapsed_ms
                && s.fix_timestamp_ms <= MAX_SAFE_INTEGER
                && if native {
                    s.fix_elapsed_ms.is_some_and(|fix| {
                        fix > 0
                            && fix <= s.observed_elapsed_ms
                            && trace
                                .started_at_ms
                                .saturating_add(fix)
                                .abs_diff(s.fix_timestamp_ms)
                                <= 1000
                    })
                } else {
                    browser && s.fix_elapsed_ms.is_none()
                }
        });
    c.collection_duration_valid = valid_times
        && trace.elapsed_ms >= p.duration_ms
        && match (trace.samples.first(), trace.samples.last()) {
            (Some(first), Some(last)) => {
                last.fix_timestamp_ms.saturating_sub(first.fix_timestamp_ms) >= p.duration_ms
                    && last
                        .observed_elapsed_ms
                        .saturating_sub(first.observed_elapsed_ms)
                        >= p.duration_ms
                    && (!native
                        || matches!((first.fix_elapsed_ms,last.fix_elapsed_ms),(Some(a),Some(b)) if b.saturating_sub(a)>=p.duration_ms))
            }
            _ => false,
        };
    let issued_ms = trace.request.challenge.issued_at.checked_mul(1000);
    let expiry_ms = trace.request.challenge.expires_at.checked_mul(1000);
    c.capture_time_in_window = matches!((issued_ms,expiry_ms),(Some(issued),Some(expiry)) if
        trace.started_at_ms >= issued && trace.ended_at_ms < expiry && sealed_at_ms < expiry
        && sealed_at_ms.saturating_add(1000) >= trace.ended_at_ms);
    c.capture_not_in_future = trace.ended_at_ms <= now_ms.saturating_add(1000)
        && sealed_at_ms <= now_ms.saturating_add(1000);
    c.fix_freshness_valid = trace.samples.iter().all(|s| {
        let observed_at = trace.started_at_ms.saturating_add(s.observed_elapsed_ms);
        issued_ms.is_some_and(|issued| s.fix_timestamp_ms >= issued)
            && s.fix_timestamp_ms <= observed_at.saturating_add(1000)
            && observed_at.saturating_sub(s.fix_timestamp_ms) <= p.max_fix_age_ms
            && (!browser
                || (s.fix_timestamp_ms >= trace.started_at_ms
                    && observed_at.saturating_sub(s.fix_timestamp_ms) <= p.max_delivery_delay_ms))
            && (!native
                || s.fix_elapsed_ms.is_some_and(|fix| {
                    fix <= s.observed_elapsed_ms
                        && s.observed_elapsed_ms - fix <= p.max_delivery_delay_ms
                }))
    }) && trace.samples.last().is_some_and(|s| {
        trace.ended_at_ms.saturating_sub(s.fix_timestamp_ms) <= p.max_fix_age_ms
            && finalization_within_policy(trace, sealed_at_ms, s.fix_timestamp_ms)
    });
    c.accuracy_valid = trace
        .samples
        .iter()
        .all(|s| finite_sample(s) && s.accuracy_m <= p.max_accuracy_m);
    c.mock_locations_rejected = trace.samples.iter().all(|s| {
        if native {
            s.mock == Some(false)
        } else {
            browser && s.mock.is_none()
        }
    });
    // Uncertainty radii are allowance, not an assurance that a position is true.
    c.motion_consistent = c.accuracy_valid
        && trace.samples.windows(2).all(|s| {
            let seconds =
                s[1].fix_timestamp_ms.saturating_sub(s[0].fix_timestamp_ms) as f64 / 1000.0;
            distance_m(&s[0], &s[1])
                <= s[0].accuracy_m + s[1].accuracy_m + p.max_speed_mps * seconds
        });
    let mut errors = Vec::new();
    if trace.version != 1 || trace.kind != "nonverba-location-trace" {
        c.policy_valid = false;
        errors.push("Unsupported location trace".into());
    }
    if !matches!(
        trace.capture_correlation.as_str(),
        "none" | "application-submission-interval"
    ) {
        c.policy_valid = false;
        errors.push("Unsupported capture correlation claim".into());
    }
    for (passed, message) in [
        (c.policy_valid, "Location request policy is invalid"),
        (
            c.source_claim_matches_policy,
            "Reported source does not match the requested profile/provider",
        ),
        (
            c.sample_count_valid,
            "Insufficient or excessive location samples",
        ),
        (
            c.sequence_valid,
            "Location samples are duplicated, missing, or out of order",
        ),
        (
            c.collection_duration_valid,
            "Distinct location fixes do not span the requested collection duration",
        ),
        (
            c.clock_consistent,
            "Location wall and elapsed clocks are inconsistent",
        ),
        (
            c.fix_freshness_valid,
            "Location fixes are stale, future-dated, or delayed",
        ),
        (
            c.accuracy_valid,
            "Location uncertainty or coordinates violate policy",
        ),
        (
            c.motion_consistent,
            "Location motion exceeds policy after uncertainty allowance",
        ),
        (
            c.mock_locations_rejected,
            "Mock status is detected or inconsistent with the source profile",
        ),
        (
            c.uncertainty_semantics_valid,
            "Permission precision or uncertainty semantics do not match the profile",
        ),
        (
            c.capture_time_in_window,
            "Collection or sealing falls outside the requester window",
        ),
        (c.capture_not_in_future, "Location evidence is future-dated"),
    ] {
        if !passed {
            errors.push(message.into());
        }
    }
    errors.extend(super::raw_gnss::evaluate_at(trace, sealed_at_ms).error_codes);
    (c, errors)
}

pub fn validate_trace(trace: &Trace, now_ms: u64) -> Result<(), String> {
    let (_, errors) = evaluate(trace, now_ms, now_ms);
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}
