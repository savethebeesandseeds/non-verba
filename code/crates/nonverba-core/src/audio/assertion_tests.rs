// SPDX-License-Identifier: AGPL-3.0-only
//! Authentic signed WAVs with ambiguous or misleading custom assertion labels.

use super::*;
use futures::executor::block_on;

const NOW: f64 = 1_790_424_000.0;

pub(crate) fn export_fixture(
    name: &str,
    wav_bytes: &[u8],
    request: &AudioRequest,
    transcript: &AudioTranscript,
    pin: &str,
    report: &AudioVerification,
) {
    let Some(directory) = std::env::var_os("NONVERBA_AUDIO_ASSERTION_FIXTURES") else {
        return;
    };
    assert!(name
        .bytes()
        .all(|byte| byte.is_ascii_lowercase() || byte == b'-'));
    let directory = std::path::PathBuf::from(directory);
    std::fs::create_dir_all(&directory).unwrap();
    let wav_name = format!("{name}.wav");
    let fixture = json!({
        "version":1,"type":"nonverba-synthetic-audio-assertion-fixture",
        "name":name,"wav":wav_name,"wav_sha256":digest(wav_bytes),
        "request_json":serde_json::to_string(request).unwrap(),
        "transcript_json":serde_json::to_string(transcript).unwrap(),
        "operator_pin":pin,"now_secs":NOW + 300.0,
        "expected":{"verified":report.verified,"checks":report.checks,
            "demo":report.demo,"capture_present":report.capture.is_some(),
            "native_audio_present":report.native_audio.is_some()}
    });
    // Only an explicitly requested test export writes files, and none contains
    // signing keys. Preserve an existing or partial run instead of overwriting.
    for (name, bytes) in [
        (wav_name, wav_bytes.to_vec()),
        (
            format!("{name}.json"),
            serde_json::to_vec_pretty(&fixture).unwrap(),
        ),
    ] {
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(directory.join(name))
            .unwrap();
        file.write_all(&bytes).unwrap();
    }
}

fn capture(request: &AudioRequest, transcript: &AudioTranscript, pcm: &[f32], pin: &str) -> Value {
    serde_json::to_value(AudioCapture {
        version: 1,
        request: request.clone(),
        transcript: transcript.clone(),
        signed_at: NOW as u64 + 5,
        device_fingerprint: pin.into(),
        pcm_sha256: hash_audio_pcm(pcm).unwrap(),
        signal_algorithm: SIGNAL_ALGORITHM.into(),
    })
    .unwrap()
}

fn sign_assertions(pcm: &[f32], identity: &str, assertions: &[(&str, Value)]) -> Vec<u8> {
    let identity: Identity = parse(identity).unwrap();
    let signer = local_signer(&identity).unwrap();
    let mut builder = Builder::from_context(context().unwrap())
        .with_definition(json!({"title":"Synthetic audio assertion-label regression"}))
        .unwrap();
    builder.set_intent(BuilderIntent::Create(DigitalSourceType::DigitalCapture));
    for (label, assertion) in assertions {
        builder.add_assertion(*label, assertion).unwrap();
    }
    let mut source = Cursor::new(wav(&encode_audio_pcm(pcm).unwrap()));
    let mut destination = Cursor::new(Vec::new());
    block_on(builder.sign_async(&signer, "audio/wav", &mut source, &mut destination)).unwrap();
    destination.into_inner()
}

fn verify(
    bytes: &[u8],
    request: &AudioRequest,
    transcript: &AudioTranscript,
    pin: &str,
) -> AudioVerification {
    parse(
        &block_on(verify_audio(
            bytes,
            &serde_json::to_string(request).unwrap(),
            &serde_json::to_string(transcript).unwrap(),
            pin,
            NOW + 300.0,
        ))
        .unwrap(),
    )
    .unwrap()
}

#[test]
fn conflicting_instanced_audio_assertions_fail_even_with_valid_c2pa_and_pcm() {
    let (request, transcript, pcm) = super::tests::fixture();
    let identity = crate::create_identity().unwrap();
    let pin = crate::identity_fingerprint(&identity).unwrap();
    let valid = capture(&request, &transcript, &pcm, &pin);
    let mut conflicting = valid.clone();
    conflicting["request"]["task"] = json!("A different signed task");
    let signed = sign_assertions(
        &pcm,
        &identity,
        &[(AUDIO_ASSERTION, valid), (AUDIO_ASSERTION, conflicting)],
    );
    let reader = block_on(
        Reader::from_context(context().unwrap())
            .with_stream_async("audio/wav", Cursor::new(&signed)),
    )
    .unwrap();
    let instances: Vec<_> = reader
        .active_manifest()
        .unwrap()
        .assertions()
        .iter()
        .filter(|assertion| assertion.label() == AUDIO_ASSERTION)
        .map(|assertion| (assertion.instance(), assertion.label_with_instance()))
        .collect();
    assert_eq!(instances.len(), 2);
    assert_eq!(instances[0], (0, AUDIO_ASSERTION.into()));
    assert_eq!(instances[1], (1, format!("{AUDIO_ASSERTION}__1")));
    let retained_pcm = decode_audio_pcm(pcm_from_wav(&signed).unwrap()).unwrap();
    assert!(detections(&retained_pcm, &transcript).unwrap().0);
    let report = verify(&signed, &request, &transcript, &pin);
    assert!(report.checks.c2pa_integrity);
    assert!(!report.verified && !report.checks.protocol_valid);
    assert!(!report.checks.request_match && report.capture.is_none());
    assert!(report
        .errors
        .iter()
        .any(|error| error.contains("must be unique")));
    export_fixture(
        "capture-conflicting-instances",
        &signed,
        &request,
        &transcript,
        &pin,
        &report,
    );
}

#[test]
fn prefixed_audio_label_cannot_replace_the_exact_artifact_domain() {
    let (request, transcript, pcm) = super::tests::fixture();
    let identity = crate::create_identity().unwrap();
    let pin = crate::identity_fingerprint(&identity).unwrap();
    let signed = sign_assertions(
        &pcm,
        &identity,
        &[(
            "org.nonverba.audio.lookalike",
            capture(&request, &transcript, &pcm, &pin),
        )],
    );
    let report = verify(&signed, &request, &transcript, &pin);
    assert!(report.checks.c2pa_integrity);
    assert!(!report.verified && !report.checks.protocol_valid);
    assert!(report.capture.is_none());
    assert!(report
        .errors
        .iter()
        .any(|error| error.contains("Missing Non-verba audio assertion")));
    export_fixture(
        "capture-prefix-only",
        &signed,
        &request,
        &transcript,
        &pin,
        &report,
    );
}

#[test]
fn earlier_prefix_match_cannot_hide_a_conflicting_exact_audio_request() {
    let (request, transcript, pcm) = super::tests::fixture();
    let identity = crate::create_identity().unwrap();
    let pin = crate::identity_fingerprint(&identity).unwrap();
    let valid = capture(&request, &transcript, &pcm, &pin);
    let mut conflicting = valid.clone();
    conflicting["request"]["task"] = json!("The actual signed task differs");
    let signed = sign_assertions(
        &pcm,
        &identity,
        &[
            ("org.nonverba.audio.lookalike", valid),
            (AUDIO_ASSERTION, conflicting),
        ],
    );
    let report = verify(&signed, &request, &transcript, &pin);
    assert!(report.checks.c2pa_integrity && report.checks.signal_detected);
    assert!(!report.verified && !report.checks.request_match);
    assert_eq!(
        report.capture.as_ref().unwrap().request.task,
        "The actual signed task differs"
    );
    export_fixture(
        "capture-prefix-before-conflict",
        &signed,
        &request,
        &transcript,
        &pin,
        &report,
    );
}

#[test]
fn unrelated_prefix_assertions_do_not_hide_or_invalidate_an_exact_audio_capture() {
    let (request, transcript, pcm) = super::tests::fixture();
    let identity = crate::create_identity().unwrap();
    let pin = crate::identity_fingerprint(&identity).unwrap();
    let signed = sign_assertions(
        &pcm,
        &identity,
        &[
            ("org.nonverba.audio.lookalike", json!({"unrelated":true})),
            (AUDIO_ASSERTION, capture(&request, &transcript, &pcm, &pin)),
        ],
    );
    let report = verify(&signed, &request, &transcript, &pin);
    assert!(
        report.verified,
        "{}",
        serde_json::to_string(&report).unwrap()
    );
    assert!(report.checks.protocol_valid && report.checks.c2pa_integrity);
    assert!(!report.demo && !report.independent_requester_proven);
    assert_eq!(report.checks.native_audio_metadata_valid, None);
    export_fixture(
        "capture-unrelated-prefix",
        &signed,
        &request,
        &transcript,
        &pin,
        &report,
    );
}
