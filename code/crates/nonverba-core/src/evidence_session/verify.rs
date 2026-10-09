// SPDX-License-Identifier: AGPL-3.0-only
use super::*;
use crate::agent_appraisal::{AppraisalReport, SensorVerification};
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

fn inputs(
    request: &SessionRequest,
    primary: &[u8],
    secondary: &[u8],
    transcript: &str,
    context: &str,
) -> Result<(), String> {
    let max_primary = match &request.spec.evidence {
        Evidence::Image(_) | Evidence::CameraLocation(_) => crate::MAX_IMAGE,
        Evidence::Location(_) => crate::location_proof::MAX_PROOF_BYTES,
        Evidence::Audio(_) => 8 * 1024 * 1024,
    };
    if primary.is_empty() || primary.len() > max_primary || context.len() > MAX_CONTEXT_BYTES {
        return Err("Evidence artifact or verifier context exceeds its limit".into());
    }
    if matches!(&request.spec.evidence, Evidence::CameraLocation(_)) {
        if secondary.is_empty() || secondary.len() > crate::location_proof::MAX_PROOF_BYTES {
            return Err("Composed location proof is empty or exceeds its limit".into());
        }
    } else if !secondary.is_empty() {
        return Err("This sensor does not accept a secondary artifact".into());
    }
    if matches!(&request.spec.evidence, Evidence::Audio(_)) {
        let _: crate::audio::AudioTranscript = parse(transcript)?;
    } else if !transcript.is_empty() {
        return Err("Only audio accepts a retained transcript".into());
    }
    Ok(())
}

async fn appraise(
    request: &SessionRequest,
    primary: &[u8],
    secondary: &[u8],
    transcript: &str,
    context: &str,
    now: f64,
) -> Result<AppraisalReport, String> {
    use crate::agent_appraisal::*;
    let sensor_request = request.spec.evidence.request_json()?;
    let policy = json(&request.spec.policy)?;
    let pins = &request.spec.operator_pins;
    let media = pins.media_certificate_sha256.as_deref().unwrap_or("");
    let location = pins.location_spki_sha256.as_deref().unwrap_or("");
    let result = match &request.spec.evidence {
        Evidence::Image(_) => {
            appraise_image_with_context_report(
                primary,
                &sensor_request,
                media,
                &policy,
                context,
                now,
            )
            .await?
        }
        Evidence::Location(_) => appraise_location_with_context_report(
            primary,
            &sensor_request,
            location,
            "null",
            &policy,
            context,
            now,
        )?,
        Evidence::CameraLocation(_) => {
            appraise_camera_location_with_context_report(
                primary,
                secondary,
                &sensor_request,
                media,
                location,
                &policy,
                context,
                now,
            )
            .await?
        }
        Evidence::Audio(_) => {
            appraise_audio_with_context_report(
                primary,
                &sensor_request,
                transcript,
                media,
                &policy,
                context,
                now,
            )
            .await?
        }
    };
    Ok(result)
}

fn timing(
    request: &SessionRequest,
    receipt: &SessionReceipt,
    now: u64,
    checks: &mut SessionChecks,
) {
    let t = &receipt.timing;
    let valid = [
        t.sent_at_ms,
        t.received_at_ms,
        t.elapsed_ms,
        receipt.sealed_at_ms,
    ]
    .iter()
    .all(|n| *n <= MAX_SAFE_INTEGER);
    checks.timing_consistent = valid
        && t.received_at_ms >= t.sent_at_ms
        && t.received_at_ms
            .saturating_sub(t.sent_at_ms)
            .abs_diff(t.elapsed_ms)
            <= WALL_TOLERANCE_MS;
    checks.response_deadline_met = valid
        && t.elapsed_ms <= request.spec.delivery.max_response_ms
        && t.received_at_ms.saturating_sub(t.sent_at_ms)
            <= request
                .spec
                .delivery
                .max_response_ms
                .saturating_add(WALL_TOLERANCE_MS);
    checks.minimum_interval_met = valid && t.elapsed_ms >= request.spec.evidence.min_response_ms();
    checks.prompt_dispatch = valid
        && t.sent_at_ms >= request.created_at_ms
        && t.sent_at_ms - request.created_at_ms <= MAX_START_DELAY_MS;
    checks.recorded_window_valid = valid
        && t.sent_at_ms >= request.issued_at_ms
        && t.received_at_ms < request.expires_at_ms
        && t.sent_at_ms
            .saturating_add(request.spec.delivery.max_response_ms)
            <= request.expires_at_ms;
    checks.sealing_time_valid = valid
        && receipt.sealed_at_ms.saturating_add(WALL_TOLERANCE_MS) >= t.received_at_ms
        && receipt.sealed_at_ms <= t.received_at_ms.saturating_add(MAX_SEAL_DELAY_MS);
    checks.not_future = valid
        && [
            request.created_at_ms,
            t.sent_at_ms,
            t.received_at_ms,
            receipt.sealed_at_ms,
        ]
        .iter()
        .all(|n| *n <= now.saturating_add(WALL_TOLERANCE_MS));
}

fn observation(
    request: &SessionRequest,
    receipt: &SessionReceipt,
    appraisal: &AppraisalReport,
    checks: &mut SessionChecks,
) {
    checks.evidence_verified = appraisal.evidence_verified;
    checks.evidence_policy_satisfied = appraisal.policy_satisfied;
    let v = &appraisal.verification;
    let requester = request.requester_pin.sha256.as_str();
    let separated = |pin: &str| hash(pin) && pin != requester;
    checks.key_roles_separated = checks.evidence_verified
        && separated(v.signer_spki())
        && (!v.composed()
            || v.location()
                .is_some_and(|location| separated(&location.device_fingerprint)));
    let secs = |n: u64| n.checked_mul(1000);
    let between = |start: Option<u64>, end: Option<u64>| match (start, end) {
        (Some(start), Some(end)) => {
            start <= end
                && start.saturating_add(WALL_TOLERANCE_MS) >= receipt.timing.sent_at_ms
                && end
                    <= receipt
                        .timing
                        .received_at_ms
                        .saturating_add(WALL_TOLERANCE_MS)
        }
        _ => false,
    };
    let location_time = |v: &crate::location_proof::Verification| {
        v.evidence.as_ref().is_some_and(|evidence| {
            between(
                Some(evidence.trace.started_at_ms),
                Some(evidence.sealed_at_ms),
            )
        })
    };
    let camera_time = |v: &crate::Verification| {
        if let Some(metadata) = &v.native_camera {
            // A complete native JPEG cannot arrive before its signed
            // finalization entry. These are device clock claims, checked with
            // the existing requester/device tolerance, not trusted clocks.
            between(
                Some(metadata.acquired_at_unix_ms),
                metadata.sealed_at_unix_ms,
            )
        } else {
            // Browser and legacy camera records retain their whole-second
            // capture claim. They do not supply native finalization timing.
            v.capture.as_ref().is_some_and(|capture| {
                between(secs(capture.captured_at), secs(capture.captured_at))
            })
        }
    };
    checks.sample_precedes_reception = checks.evidence_verified
        && match v {
            SensorVerification::Image(image) => camera_time(image),
            SensorVerification::Location(location) => location_time(location),
            SensorVerification::CameraLocation(composed) => {
                location_time(&composed.location) && camera_time(&composed.image)
            }
            SensorVerification::Audio(audio) => audio.capture.as_ref().is_some_and(|capture| {
                between(secs(capture.transcript.started_at), secs(capture.signed_at))
            }),
        };
    checks.demo_marker_valid =
        receipt.demo == request.spec.evidence.demo() && appraisal.demo == receipt.demo;
}

fn failures(checks: &SessionChecks) -> Vec<String> {
    [
        (
            checks.request_authenticated,
            "EVIDENCE_REQUEST_AUTHENTICATION",
        ),
        (
            checks.receipt_authenticated,
            "EVIDENCE_RECEIPT_AUTHENTICATION",
        ),
        (checks.original_request_match, "EVIDENCE_ORIGINAL_REQUEST"),
        (checks.session_binding, "EVIDENCE_SESSION_BINDING"),
        (checks.artifact_bindings, "EVIDENCE_ARTIFACT_BINDINGS"),
        (checks.context_binding, "EVIDENCE_CONTEXT_BINDING"),
        (checks.timing_consistent, "EVIDENCE_TIMING"),
        (checks.response_deadline_met, "EVIDENCE_RESPONSE_DEADLINE"),
        (checks.minimum_interval_met, "EVIDENCE_MINIMUM_INTERVAL"),
        (checks.prompt_dispatch, "EVIDENCE_PROMPT_DISPATCH"),
        (checks.recorded_window_valid, "EVIDENCE_RECORDED_WINDOW"),
        (checks.sealing_time_valid, "EVIDENCE_SEALING_TIME"),
        (checks.not_future, "EVIDENCE_FUTURE_TIME"),
        (checks.evidence_verified, "EVIDENCE_SENSOR_VERIFICATION"),
        (checks.evidence_policy_satisfied, "EVIDENCE_POLICY"),
        (checks.key_roles_separated, "EVIDENCE_KEY_ROLES"),
        (
            checks.sample_precedes_reception,
            "EVIDENCE_SAMPLE_OBSERVATION",
        ),
        (checks.demo_marker_valid, "EVIDENCE_DEMO_MARKER"),
    ]
    .into_iter()
    .filter(|(passed, _)| !passed)
    .map(|(_, code)| code.into())
    .collect()
}

fn empty_report() -> SessionVerification {
    SessionVerification {
        version: 1,
        kind: "nonverba-evidence-session-verification".into(),
        verified: false,
        fresh_action_eligible: false,
        demo: false,
        checks: SessionChecks::default(),
        request: None,
        request_binding: None,
        receipt: None,
        appraisal: None,
        acceptance_recorded: false,
        local_replay_checked: false,
        global_replay_checked: false,
        requester_clock_trusted: false,
        independent_requester_proven: false,
        physical_measurement_authenticity_proven: false,
        errors: Vec::new(),
    }
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
#[allow(clippy::too_many_arguments)] // Exact artifacts, retained trust and observation are independent inputs.
pub async fn seal_evidence_session_receipt(
    original_request_envelope: &str,
    primary_bytes: &[u8],
    secondary_bytes: &[u8],
    audio_transcript_json: &str,
    timing_json: &str,
    requester_identity_json: &str,
    expected_requester_pin: &str,
    context_json: &str,
    now_secs: f64,
) -> Result<String, String> {
    let original = request_bytes(original_request_envelope)?;
    let request = protocol::authenticate(&original, expected_requester_pin)?;
    inputs(
        &request,
        primary_bytes,
        secondary_bytes,
        audio_transcript_json,
        context_json,
    )?;
    let signer = cose::RequesterIdentity::load(requester_identity_json)?;
    if signer.pin != expected_requester_pin
        || STANDARD.encode(&signer.spki) != request.requester_public_spki_der_b64
    {
        return Err("Receipt signer differs from the retained requester identity".into());
    }
    let now = millis(now_secs)?;
    let receipt = SessionReceipt {
        version: 1,
        kind: "nonverba-evidence-session-receipt-payload".into(),
        session_id: request.session_id.clone(),
        request_binding: binding(&original),
        primary_binding: binding(primary_bytes),
        secondary_binding: binding(secondary_bytes),
        audio_transcript_binding: binding(audio_transcript_json.as_bytes()),
        context_binding: binding(context_json.as_bytes()),
        requester_pin: request.requester_pin.clone(),
        requester_public_spki_der_b64: request.requester_public_spki_der_b64.clone(),
        timing: parse(timing_json)?,
        sealed_at_ms: now,
        demo: request.spec.evidence.demo(),
    };
    let mut checks = SessionChecks {
        request_authenticated: true,
        receipt_authenticated: true,
        original_request_match: true,
        session_binding: true,
        artifact_bindings: true,
        context_binding: true,
        ..Default::default()
    };
    timing(&request, &receipt, now, &mut checks);
    let appraisal = appraise(
        &request,
        primary_bytes,
        secondary_bytes,
        audio_transcript_json,
        context_json,
        now_secs,
    )
    .await?;
    observation(&request, &receipt, &appraisal, &mut checks);
    let errors = failures(&checks);
    if !errors.is_empty() {
        return Err(format!(
            "Evidence receipt failed verification: {}",
            errors.join(", ")
        ));
    }
    json(&ReceiptEnvelope {
        version: 1,
        kind: "nonverba-evidence-session-receipt".into(),
        request_cose_b64: STANDARD.encode(original),
        receipt_cose_b64: STANDARD.encode(cose::sign(&receipt, &signer, RECEIPT_TYPE)?),
    })
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
#[allow(clippy::too_many_arguments)] // Original authority and artifact bytes cannot be replaced by a supplied report.
pub async fn verify_evidence_session_receipt(
    receipt_envelope: &str,
    original_request_envelope: &str,
    primary_bytes: &[u8],
    secondary_bytes: &[u8],
    audio_transcript_json: &str,
    expected_requester_pin: &str,
    context_json: &str,
    now_secs: f64,
) -> Result<String, String> {
    let now = millis(now_secs)?;
    if !hash(expected_requester_pin) {
        return Err("An independently retained requester SPKI pin is required".into());
    }
    let mut report = empty_report();
    let parsed = (|| {
        let original = request_bytes(original_request_envelope)?;
        let request = protocol::authenticate(&original, expected_requester_pin)?;
        inputs(
            &request,
            primary_bytes,
            secondary_bytes,
            audio_transcript_json,
            context_json,
        )?;
        let envelope: ReceiptEnvelope = parse(receipt_envelope)?;
        if envelope.version != 1 || envelope.kind != "nonverba-evidence-session-receipt" {
            return Err("Unsupported evidence receipt envelope".to_owned());
        }
        let included = decode(&envelope.request_cose_b64)?;
        let receipt =
            cose::read::<SessionReceipt>(&decode(&envelope.receipt_cose_b64)?, RECEIPT_TYPE)?;
        Ok((original, included, request, receipt))
    })();
    let (original, included, request, signed) = match parsed {
        Ok(values) => values,
        Err(error) => {
            report.errors.push(error);
            return json(&report);
        }
    };
    let receipt = signed.payload;
    let c = &mut report.checks;
    c.request_authenticated = true;
    c.receipt_authenticated = signed.signature_valid
        && signed.pin == expected_requester_pin
        && receipt.requester_pin == request.requester_pin
        && receipt.requester_public_spki_der_b64 == request.requester_public_spki_der_b64;
    c.original_request_match = original == included;
    c.session_binding = receipt.version == 1
        && receipt.kind == "nonverba-evidence-session-receipt-payload"
        && receipt.session_id == request.session_id
        && receipt.request_binding == binding(&original);
    c.artifact_bindings = receipt.primary_binding == binding(primary_bytes)
        && receipt.secondary_binding == binding(secondary_bytes)
        && receipt.audio_transcript_binding == binding(audio_transcript_json.as_bytes());
    c.context_binding = receipt.context_binding == binding(context_json.as_bytes());
    timing(&request, &receipt, now, c);
    match appraise(
        &request,
        primary_bytes,
        secondary_bytes,
        audio_transcript_json,
        context_json,
        now_secs,
    )
    .await
    {
        Ok(appraisal) => {
            observation(&request, &receipt, &appraisal, c);
            report.appraisal = Some(serde_json::to_value(appraisal).map_err(crate::err)?);
        }
        Err(error) => report.errors.push(error),
    }
    report.errors.extend(failures(c));
    report.verified = report.errors.is_empty();
    report.demo = request.spec.evidence.demo();
    report.fresh_action_eligible = report.verified
        && !report.demo
        && now >= request.issued_at_ms
        && now < request.expires_at_ms
        // Public time input is integer seconds: use the end of that second so
        // a millisecond age policy never gains an unreported extra second.
        && now.saturating_add(999).saturating_sub(receipt.timing.received_at_ms)
            <= request.spec.delivery.max_receipt_age_ms;
    report.request_binding = Some(binding(&original));
    report.request = Some(request);
    report.receipt = Some(receipt);
    json(&report)
}
