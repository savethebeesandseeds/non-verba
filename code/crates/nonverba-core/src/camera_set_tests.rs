use super::*;
use serde_json::json;

fn camera(id: &str, lens_facing: LensFacing) -> CameraDescriptor {
    CameraDescriptor {
        camera_id: id.into(),
        lens_facing,
    }
}

fn front_back() -> CameraSetProfile {
    CameraSetProfile {
        version: 1,
        kind: CameraSetKind::FrontBack,
        cameras: vec![
            camera("rear", LensFacing::Back),
            camera("selfie", LensFacing::Front),
        ],
        timing: CaptureTiming::Concurrent {
            max_start_skew_ns: "10".into(),
        },
    }
}

fn start(id: &str, time: &str) -> CaptureStart {
    CaptureStart {
        camera_id: id.into(),
        timebase_id: Some("same-device-clock".into()),
        start_ns: Some(time.into()),
    }
}

#[test]
fn single_camera_computer_needs_no_invented_front_camera() {
    for lens_facing in [LensFacing::External, LensFacing::Unknown, LensFacing::Front] {
        let profile = CameraSetProfile {
            version: 1,
            kind: CameraSetKind::SingleCamera,
            cameras: vec![camera("opaque-device-id", lens_facing)],
            timing: CaptureTiming::Single {},
        };
        let inventory = CameraSetCapabilities {
            cameras: profile.cameras.clone(),
            concurrent_sets: None,
        };
        let report = assess_capabilities(&profile, &inventory).unwrap();
        assert!(report.missing_camera_ids.is_empty());
        assert!(report.facing_mismatch_ids.is_empty());
        assert_eq!(report.concurrency, ConcurrencyAdvertisement::NotRequired);
        assert_eq!(
            assess_timing(&profile, &[start("opaque-device-id", "1")]).unwrap(),
            TimingAssessment::NotRequired
        );
    }
}

#[test]
fn required_front_back_set_never_reduces_to_the_available_rear_camera() {
    let profile = front_back();
    let inventory = CameraSetCapabilities {
        cameras: vec![camera("rear", LensFacing::Back)],
        concurrent_sets: Some(vec![]),
    };
    let original = profile.clone();
    let report = assess_capabilities(&profile, &inventory).unwrap();
    assert_eq!(report.missing_camera_ids, ["selfie"]);
    assert_eq!(report.concurrency, ConcurrencyAdvertisement::NotAdvertised);
    assert_eq!(profile, original);
    assert_eq!(
        assess_timing(&profile, &[start("rear", "1")]).unwrap(),
        TimingAssessment::Unassessable
    );
}

#[test]
fn profiles_require_exact_membership_facings_and_timing_shape() {
    let profile = front_back();
    profile.validate().unwrap();
    let mut cases = Vec::new();
    let mut bad = profile.clone();
    bad.version = 2;
    cases.push(bad);
    let mut bad = profile.clone();
    bad.cameras.clear();
    cases.push(bad);
    let mut bad = profile.clone();
    bad.cameras[1].camera_id = "rear".into();
    cases.push(bad);
    let mut bad = profile.clone();
    bad.cameras[1].lens_facing = LensFacing::Back;
    cases.push(bad);
    let mut bad = profile.clone();
    bad.kind = CameraSetKind::SingleCamera;
    cases.push(bad);
    let mut bad = profile.clone();
    bad.timing = CaptureTiming::Single {};
    cases.push(bad);
    let mut bad = profile.clone();
    bad.cameras[0].camera_id = " \t".into();
    cases.push(bad);
    let mut bad = profile.clone();
    bad.cameras[0].camera_id = "line\nbreak".into();
    cases.push(bad);
    let mut bad = profile.clone();
    bad.cameras[0].camera_id = "x".repeat(129);
    cases.push(bad);
    for bad in cases {
        assert!(bad.validate().is_err(), "accepted {bad:?}");
    }
}

#[test]
fn additional_required_cameras_remain_part_of_the_profile() {
    let mut profile = front_back();
    profile.cameras.push(camera("wide", LensFacing::Back));
    let inventory = CameraSetCapabilities {
        cameras: profile.cameras.clone(),
        concurrent_sets: Some(vec![vec!["rear".into(), "selfie".into()]]),
    };
    let report = assess_capabilities(&profile, &inventory).unwrap();
    assert!(report.missing_camera_ids.is_empty());
    assert_eq!(report.concurrency, ConcurrencyAdvertisement::NotAdvertised);
}

#[test]
fn unknown_concurrency_and_no_advertised_combination_remain_distinct() {
    let profile = front_back();
    let mut inventory = CameraSetCapabilities {
        cameras: profile.cameras.clone(),
        concurrent_sets: None,
    };
    assert_eq!(
        assess_capabilities(&profile, &inventory)
            .unwrap()
            .concurrency,
        ConcurrencyAdvertisement::Unknown
    );
    inventory.concurrent_sets = Some(vec![]);
    assert_eq!(
        assess_capabilities(&profile, &inventory)
            .unwrap()
            .concurrency,
        ConcurrencyAdvertisement::NotAdvertised
    );
    inventory.concurrent_sets = Some(vec![vec!["selfie".into(), "rear".into()]]);
    assert_eq!(
        assess_capabilities(&profile, &inventory)
            .unwrap()
            .concurrency,
        ConcurrencyAdvertisement::Advertised
    );
    inventory.cameras[1].lens_facing = LensFacing::Back;
    let report = assess_capabilities(&profile, &inventory).unwrap();
    assert_eq!(report.facing_mismatch_ids, ["selfie"]);
    // Advertising a combination cannot erase an independent role mismatch.
    assert_eq!(report.concurrency, ConcurrencyAdvertisement::Advertised);
}

#[test]
fn capability_combinations_cannot_invent_duplicate_or_unknown_members() {
    let profile = front_back();
    for groups in [
        vec![vec!["rear".into()]],
        vec![vec!["rear".into(), "rear".into()]],
        vec![vec!["rear".into(), "missing".into()]],
        vec![
            vec!["rear".into(), "selfie".into()],
            vec!["selfie".into(), "rear".into()],
        ],
    ] {
        let inventory = CameraSetCapabilities {
            cameras: profile.cameras.clone(),
            concurrent_sets: Some(groups),
        };
        assert!(assess_capabilities(&profile, &inventory).is_err());
    }
    let inventory = CameraSetCapabilities {
        cameras: vec![profile.cameras[0].clone(); 2],
        concurrent_sets: None,
    };
    assert!(assess_capabilities(&profile, &inventory).is_err());
}

#[test]
fn timing_uses_exact_counter_arithmetic_and_an_inclusive_requested_limit() {
    let profile = front_back();
    // Counters exceed the exact JavaScript integer range.
    let baseline = 9_007_199_254_740_993u64;
    for (difference, expected) in [
        (0, TimingAssessment::WithinRequestedSkew),
        (10, TimingAssessment::WithinRequestedSkew),
        (11, TimingAssessment::ExceedsRequestedSkew),
    ] {
        let starts = [
            start("rear", &baseline.to_string()),
            start("selfie", &(baseline + difference).to_string()),
        ];
        assert_eq!(assess_timing(&profile, &starts).unwrap(), expected);
    }
    let starts = [
        start("rear", &u64::MAX.to_string()),
        start("selfie", &(u64::MAX - 10).to_string()),
    ];
    assert_eq!(
        assess_timing(&profile, &starts).unwrap(),
        TimingAssessment::WithinRequestedSkew
    );
}

#[test]
fn missing_or_different_timebases_never_receive_concurrent_timing_credit() {
    let profile = front_back();
    let original = vec![start("rear", "100"), start("selfie", "101")];
    for variant in 0..4 {
        let mut starts = original.clone();
        match variant {
            0 => starts[0].timebase_id = None,
            1 => starts[0].start_ns = None,
            2 => starts[1].timebase_id = Some("other-clock".into()),
            _ => {
                starts.pop();
            }
        }
        assert_eq!(
            assess_timing(&profile, &starts).unwrap(),
            TimingAssessment::Unassessable
        );
    }
    assert_eq!(
        assess_timing(&profile, &[]).unwrap(),
        TimingAssessment::Unassessable
    );
}

#[test]
fn unexpected_duplicate_or_malformed_starts_are_refused() {
    let profile = front_back();
    for starts in [
        vec![start("rear", "1"), start("rear", "2")],
        vec![start("rear", "1"), start("other", "2")],
        vec![start("rear", "01"), start("selfie", "2")],
        vec![start("rear", "18446744073709551616"), start("selfie", "2")],
    ] {
        assert!(assess_timing(&profile, &starts).is_err());
    }
}

#[test]
fn skew_limits_are_explicit_and_lossless_instead_of_defaulted() {
    for invalid in ["", "01", "-1", "1.0", "1e3", "18446744073709551616"] {
        let mut profile = front_back();
        profile.timing = CaptureTiming::Concurrent {
            max_start_skew_ns: invalid.into(),
        };
        assert!(profile.validate().is_err(), "accepted {invalid}");
    }
    let mut profile = front_back();
    profile.timing = CaptureTiming::Concurrent {
        max_start_skew_ns: "0".into(),
    };
    profile.validate().unwrap();
    assert_eq!(
        assess_timing(&profile, &[start("rear", "1"), start("selfie", "2")]).unwrap(),
        TimingAssessment::ExceedsRequestedSkew
    );
}

#[test]
fn strict_json_refuses_ambiguous_unknown_or_missing_policy() {
    let profile = front_back();
    let original = serde_json::to_string(&profile).unwrap();
    assert_eq!(parse_profile(&original).unwrap(), profile);
    let mut unknown = serde_json::to_value(&profile).unwrap();
    unknown["automatic_fallback"] = json!(true);
    assert!(parse_profile(&unknown.to_string()).is_err());
    let mut unknown_timing = serde_json::to_value(&profile).unwrap();
    unknown_timing["timing"]["automatic_fallback"] = json!(true);
    assert!(parse_profile(&unknown_timing.to_string()).is_err());
    let unknown_single = json!({
        "version": 1,
        "kind": "single-camera",
        "cameras": [{"camera_id":"pc", "lens_facing":"external"}],
        "timing": {"mode":"single", "max_start_skew_ns":"10"}
    });
    assert!(parse_profile(&unknown_single.to_string()).is_err());
    let mut unknown_camera = serde_json::to_value(&profile).unwrap();
    unknown_camera["cameras"][0]["operator_supplied"] = json!(true);
    assert!(parse_profile(&unknown_camera.to_string()).is_err());
    let mut missing = serde_json::to_value(&profile).unwrap();
    missing["timing"] = json!({"mode":"concurrent"});
    assert!(parse_profile(&missing.to_string()).is_err());
    let duplicate = original.replacen("\"version\":1", "\"version\":1,\"version\":1", 1);
    assert!(parse_profile(&duplicate).is_err());
    assert!(parse_profile(&" ".repeat(MAX_PROFILE_BYTES + 1)).is_err());
}

#[test]
fn profile_and_inventory_work_are_bounded() {
    let mut profile = front_back();
    for index in 2..=MAX_CAMERAS {
        profile
            .cameras
            .push(camera(&format!("extra-{index}"), LensFacing::Back));
    }
    assert!(profile.validate().is_err());
    let profile = front_back();
    let inventory = CameraSetCapabilities {
        cameras: profile.cameras.clone(),
        concurrent_sets: Some(vec![
            vec!["rear".into(), "selfie".into()];
            MAX_CONCURRENT_SETS + 1
        ]),
    };
    assert!(assess_capabilities(&profile, &inventory).is_err());
}

#[test]
fn sequential_is_explicit_needs_no_concurrency_and_retains_all_members() {
    let mut profile = front_back();
    profile.timing = CaptureTiming::Sequential {};
    assert_eq!(
        parse_profile(&serde_json::to_string(&profile).unwrap()).unwrap(),
        profile
    );
    let mut inventory = CameraSetCapabilities {
        cameras: profile.cameras.clone(),
        concurrent_sets: Some(vec![]),
    };
    assert_eq!(
        assess_capabilities(&profile, &inventory)
            .unwrap()
            .concurrency,
        ConcurrencyAdvertisement::NotRequired
    );
    inventory.cameras.pop();
    assert_eq!(
        assess_capabilities(&profile, &inventory)
            .unwrap()
            .missing_camera_ids,
        ["selfie"]
    );
    let mut invalid = serde_json::to_value(&profile).unwrap();
    invalid["timing"]["max_start_skew_ns"] = json!("10");
    assert!(parse_profile(&invalid.to_string()).is_err());
    profile.kind = CameraSetKind::SingleCamera;
    assert!(profile.validate().is_err());
}

#[test]
fn sequential_gap_is_exact_and_order_comes_from_profile_not_transport() {
    let mut profile = front_back();
    profile.timing = CaptureTiming::Sequential {};
    let baseline = 9_007_199_254_740_993u64;
    let starts = [
        start("selfie", &(baseline + 2_345_678_901).to_string()),
        start("rear", &baseline.to_string()),
    ];
    let report = assess_timing_report(&profile, &starts).unwrap();
    assert_eq!(
        report.assessment,
        TimingAssessment::SequentialOrderConfirmed
    );
    assert_eq!(report.exposure_start_span_ns.as_deref(), Some("2345678901"));
    profile.cameras.reverse();
    assert_eq!(
        assess_timing(&profile, &starts).unwrap(),
        TimingAssessment::SequentialOrderViolated
    );
    assert_eq!(
        assess_timing(&profile, &[start("rear", "1"), start("selfie", "1")]).unwrap(),
        TimingAssessment::SequentialOrderViolated
    );
    let mut unknown = starts.clone();
    unknown[0].timebase_id = None;
    assert_eq!(
        assess_timing_report(&profile, &unknown).unwrap(),
        TimingReport {
            assessment: TimingAssessment::Unassessable,
            exposure_start_span_ns: None
        }
    );
    assert_eq!(
        assess_timing(&profile, &starts[..1]).unwrap(),
        TimingAssessment::Unassessable
    );
}
