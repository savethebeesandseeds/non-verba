// SPDX-License-Identifier: AGPL-3.0-only
use super::*;
use image::{codecs::jpeg::JpegEncoder, Rgb, RgbImage};
use serde_json::{json, Value};

fn jpeg(width: u32, height: u32, pixel: impl Fn(u32, u32) -> [u8; 3]) -> Vec<u8> {
    let image = RgbImage::from_fn(width, height, |x, y| Rgb(pixel(x, y)));
    let mut bytes = Vec::new();
    JpegEncoder::new_with_quality(&mut bytes, 100)
        .encode_image(&image)
        .unwrap();
    bytes
}

fn report(bytes: &[u8]) -> CameraQualityReport {
    analyze_camera_quality_typed(bytes, &CameraQualityProfile::default()).unwrap()
}

fn exif_segment(orientation: u16) -> Vec<u8> {
    let mut payload = b"Exif\0\0II\x2a\0\x08\0\0\0\x01\0\x12\x01\x03\0\x01\0\0\0".to_vec();
    payload.extend_from_slice(&orientation.to_le_bytes());
    payload.extend_from_slice(&[0; 6]);
    let mut segment = vec![0xff, 0xe1];
    segment.extend_from_slice(&((payload.len() + 2) as u16).to_be_bytes());
    segment.extend(payload);
    segment
}

fn with_orientation(jpeg: &[u8], orientation: u16) -> Vec<u8> {
    let mut output = jpeg[..2].to_vec();
    output.extend(exif_segment(orientation));
    output.extend_from_slice(&jpeg[2..]);
    output
}

// This helper changes only the encoded dimensions of a tiny fixture, exercising
// pre-allocation header bounds without allocating a large image or decode output.
fn replace_dimensions(bytes: &[u8], width: u16, height: u16) -> Vec<u8> {
    let mut patched = bytes.to_vec();
    let sof = patched
        .windows(2)
        .position(|marker| marker == [0xff, 0xc0])
        .unwrap();
    patched[sof + 5..sof + 7].copy_from_slice(&height.to_be_bytes());
    patched[sof + 7..sof + 9].copy_from_slice(&width.to_be_bytes());
    patched
}

#[test]
fn default_profile_is_complete_strict_and_guidance_only() {
    let bytes = jpeg(24, 16, |x, y| [(x * 7) as u8, (y * 11) as u8, 80]);
    let profile_json = camera_quality_profile();
    let profile: CameraQualityProfile = serde_json::from_str(&profile_json).unwrap();
    assert_eq!(profile, CameraQualityProfile::default());
    let serialized = analyze_camera_quality(&bytes, &profile_json).unwrap();
    assert_eq!(serialized, serde_json::to_string(&report(&bytes)).unwrap());
    let actual: Value = serde_json::from_str(&serialized).unwrap();
    assert_eq!(actual["type"], "nonverba-camera-quality-report");
    assert_eq!(actual["guidance_only"], true);
    assert_eq!(actual["satisfies_successful_measurement"], false);
    assert_eq!(actual["authenticity_proven"], false);
    assert!(actual.get("verified").is_none());
    assert!(actual.get("meets_requirements").is_none());
    assert!(actual.get("score").is_none());
    assert_eq!(actual["image_sha256"], hex::encode(Sha256::digest(&bytes)));
    assert_eq!(
        actual["analysis_profile_sha256"],
        hex::encode(Sha256::digest(profile_json.as_bytes()))
    );
    assert_eq!(
        actual["profile"],
        serde_json::from_str::<Value>(&profile_json).unwrap()
    );
    assert_eq!(actual["regions"].as_array().unwrap().len(), 5);
    assert_eq!(actual["rules"]["scales"], json!([1, 2, 4]));
    assert!(actual["guidance"]
        .as_array()
        .unwrap()
        .contains(&json!("subject-region-not-selected")));
}

#[test]
fn image_and_semantic_profile_digests_change_independently() {
    let bytes = jpeg(24, 24, |x, y| [(x * 7) as u8, (y * 7) as u8, 80]);
    let mut changed_bytes = bytes.clone();
    changed_bytes.extend_from_slice(b"retained after JPEG end");
    let before = report(&bytes);
    let after = report(&changed_bytes);
    assert_ne!(before.image_sha256, after.image_sha256);
    assert_eq!(
        before.analysis_profile_sha256,
        after.analysis_profile_sha256
    );
    assert_eq!(before.regions, after.regions);
    let profile = CameraQualityProfile {
        subject_region: Some(PixelRegion {
            x: 2,
            y: 2,
            width: 12,
            height: 12,
        }),
        ..CameraQualityProfile::default()
    };
    let with_subject = analyze_camera_quality_typed(&bytes, &profile).unwrap();
    assert_ne!(
        before.analysis_profile_sha256,
        with_subject.analysis_profile_sha256
    );
    assert_eq!(before.image_sha256, with_subject.image_sha256);
    let whitespace = format!("\n {} \n", serde_json::to_string(&profile).unwrap());
    let raw: Value =
        serde_json::from_str(&analyze_camera_quality(&bytes, &whitespace).unwrap()).unwrap();
    assert_eq!(
        raw["analysis_profile_sha256"],
        with_subject.analysis_profile_sha256
    );
}

#[test]
fn rgb_to_encoded_luma_has_exact_integer_rounding() {
    assert_eq!(encoded_luma(0, 0, 0), 0);
    assert_eq!(encoded_luma(255, 255, 255), 255);
    assert_eq!(encoded_luma(255, 0, 0), 77);
    assert_eq!(encoded_luma(0, 255, 0), 149);
    assert_eq!(encoded_luma(0, 0, 255), 29);
    assert_eq!(encoded_luma(128, 128, 128), 128);
    // Red values straddle half-up rounding at 77R/256.
    assert_eq!(encoded_luma(1, 0, 0), 0);
    assert_eq!(encoded_luma(2, 0, 0), 1);
}

#[test]
fn uniform_dark_bright_and_gray_are_not_focus_verdicts() {
    for value in [0, 128, 255] {
        let actual = report(&jpeg(24, 24, |_, _| [value; 3]));
        for region in &actual.regions {
            assert_eq!(
                region.exposure.sample_count,
                u64::from(region.bounds.width * region.bounds.height)
            );
            assert_eq!(region.exposure.range, 0);
            assert_eq!(region.exposure.minimum, value);
            assert_eq!(region.exposure.maximum, value);
            assert_eq!(
                region.exposure.histogram[value as usize],
                region.exposure.sample_count
            );
            assert_eq!(
                region.exposure.histogram.iter().sum::<u64>(),
                region.exposure.sample_count
            );
            assert_eq!(
                region.exposure.near_black_count,
                if value == 0 {
                    region.exposure.sample_count
                } else {
                    0
                }
            );
            assert_eq!(
                region.exposure.near_white_count,
                if value == 255 {
                    region.exposure.sample_count
                } else {
                    0
                }
            );
            for metric in &region.sharpness {
                assert_eq!(metric.assessment, "insufficient-texture");
                assert_eq!(metric.gradient_squared_sum, 0);
                assert_eq!(metric.nonzero_gradient_count, 0);
            }
        }
        assert!(actual.guidance_only);
        assert!(!actual.satisfies_successful_measurement);
    }
}

#[test]
fn exposure_bins_and_inclusive_clipping_counts_use_available_pixels() {
    let pixels = [0, 5, 6, 249, 250, 255];
    let actual = measure_region(
        "oracle",
        PixelRegion {
            x: 0,
            y: 0,
            width: 6,
            height: 1,
        },
        &pixels,
        6,
    );
    assert_eq!(actual.exposure.sample_count, 6);
    assert_eq!(actual.exposure.near_black_count, 2);
    assert_eq!(actual.exposure.near_white_count, 2);
    assert_eq!(actual.exposure.minimum, 0);
    assert_eq!(actual.exposure.maximum, 255);
    assert_eq!(actual.exposure.range, 255);
    for value in pixels {
        assert_eq!(actual.exposure.histogram[value as usize], 1);
    }
    for metric in &actual.sharpness {
        assert_eq!(metric.assessment, "insufficient-data");
    }
}

#[test]
fn delivered_jpeg_clipping_and_small_windows_remain_explicit() {
    let actual = report(&jpeg(32, 16, |x, _| if x < 16 { [0; 3] } else { [255; 3] }));
    assert_eq!(actual.regions[0].exposure.sample_count, 512);
    assert_eq!(actual.regions[0].exposure.near_black_count, 256);
    assert_eq!(actual.regions[0].exposure.near_white_count, 256);
    let tiny = report(&jpeg(1, 2, |_, y| [if y == 0 { 0 } else { 255 }; 3]));
    assert_eq!(tiny.regions[0].exposure.sample_count, 2);
    assert_eq!(tiny.regions.len(), 3); // full frame and the two nonempty grid tiles
    assert!(tiny
        .regions
        .iter()
        .flat_map(|region| &region.sharpness)
        .all(|metric| metric.assessment == "insufficient-data" && metric.sample_count == 0));
}

#[test]
fn sobel_matches_analytic_ramp_and_ignores_unavailable_border_centers() {
    // f(x,y)=3x+5y. A 3x3 Sobel stencil has gx=8*3, gy=8*5.
    let metric = measure_gradients(7, 6, 1, |x, y| (3 * x + 5 * y) as u8);
    assert_eq!(metric.sample_count, 5 * 4);
    assert_eq!(metric.gradient_squared_sum, 20 * (24 * 24 + 40 * 40));
    assert_eq!(metric.nonzero_gradient_count, 20);
    assert_eq!(metric.assessment, "measured");
    for (width, height) in [(0, 0), (2, 12), (12, 2), (1, 1)] {
        let small = measure_gradients(width, height, 1, |_, _| {
            panic!("No unavailable pixels may be read")
        });
        assert_eq!(small.sample_count, 0);
        assert_eq!(small.assessment, "insufficient-data");
    }
}

#[test]
fn sobel_has_exact_maximum_and_orientation_symmetry() {
    let vertical_edge = |x, _| if x == 2 { 255 } else { 0 };
    let horizontal_edge = |_, y| if y == 2 { 255 } else { 0 };
    let vertical = measure_gradients(3, 3, 1, vertical_edge);
    let horizontal = measure_gradients(3, 3, 1, horizontal_edge);
    assert_eq!(vertical.sample_count, 1);
    assert_eq!(vertical.gradient_squared_sum, 1020 * 1020);
    assert_eq!(
        horizontal.gradient_squared_sum,
        vertical.gradient_squared_sum
    );
}

#[test]
fn box_means_are_rounded_half_up_and_do_not_read_outside_subject() {
    let pixels = [
        255, 255, 255, 255, 255, 255, 0, 0, 1, 255, 255, 1, 1, 0, 255, 255, 255, 255, 255, 255,
    ];
    let region = PixelRegion {
        x: 1,
        y: 1,
        width: 3,
        height: 2,
    };
    // Only [0,0;1,1] contributes. The unpaired right column is discarded.
    assert_eq!(box_average(&pixels, 5, &region, 2), vec![1]);
    let metric = measure_region("subject", region, &pixels, 5);
    assert_eq!(metric.exposure.sample_count, 6);
    assert_eq!(metric.exposure.maximum, 1);
    assert_eq!(metric.sharpness[1].width, 1);
    assert_eq!(metric.sharpness[1].height, 1);
    assert_eq!(metric.sharpness[1].assessment, "insufficient-data");
}

#[test]
fn multiscale_measurement_observes_scale_specific_texture() {
    let width = 32;
    // A two-pixel period stripe has edges at scale 1, while each 4-pixel
    // box has the same average. Coarse-scale lack of texture stays inconclusive.
    let pixels: Vec<u8> = (0..width * width)
        .map(|index| if (index % width) % 4 < 2 { 0 } else { 255 })
        .collect();
    let actual = measure_region(
        "stripes",
        PixelRegion {
            x: 0,
            y: 0,
            width,
            height: width,
        },
        &pixels,
        width,
    );
    assert_eq!(
        actual
            .sharpness
            .iter()
            .map(|metric| metric.scale)
            .collect::<Vec<_>>(),
        [1, 2, 4]
    );
    assert_eq!(actual.sharpness[0].assessment, "measured");
    assert_eq!(actual.sharpness[2].assessment, "insufficient-texture");
    assert_eq!(actual.sharpness[0].sample_count, 30 * 30);
    assert_eq!(actual.sharpness[1].sample_count, 14 * 14);
    assert_eq!(actual.sharpness[2].sample_count, 6 * 6);
}

#[test]
fn a_textured_background_does_not_substitute_for_uniform_subject_pixels() {
    let width = 48;
    let pixels: Vec<u8> = (0..width * width)
        .map(|index| {
            let x = index % width;
            let y = index / width;
            if (16..32).contains(&x) && (16..32).contains(&y) {
                128
            } else if (x / 2 + y / 2) % 2 == 0 {
                10
            } else {
                240
            }
        })
        .collect();
    let full = measure_region(
        "full",
        PixelRegion {
            x: 0,
            y: 0,
            width,
            height: width,
        },
        &pixels,
        width,
    );
    let subject = measure_region(
        "subject",
        PixelRegion {
            x: 16,
            y: 16,
            width: 16,
            height: 16,
        },
        &pixels,
        width,
    );
    assert_eq!(full.sharpness[0].assessment, "measured");
    assert!(subject
        .sharpness
        .iter()
        .all(|metric| metric.assessment == "insufficient-texture"));
    let bytes = jpeg(width, width, |x, y| [pixels[(y * width + x) as usize]; 3]);
    let profile = CameraQualityProfile {
        subject_region: Some(subject.bounds.clone()),
        ..CameraQualityProfile::default()
    };
    let delivered = analyze_camera_quality_typed(&bytes, &profile).unwrap();
    let subject = delivered
        .regions
        .iter()
        .find(|region| region.id == "subject")
        .unwrap();
    assert!(subject
        .sharpness
        .iter()
        .all(|metric| metric.assessment == "insufficient-texture"));
    assert_eq!(delivered.regions[0].sharpness[0].assessment, "measured");
    assert!(!delivered
        .guidance
        .iter()
        .any(|code| code == "subject-region-not-selected"));
}

#[test]
fn blurred_synthetic_step_reduces_fine_scale_gradient_energy_without_passing_threshold() {
    let sharp = measure_gradients(24, 16, 1, |x, _| if x < 12 { 0 } else { 240 });
    let blurred = measure_gradients(24, 16, 1, |x, _| match x {
        0..=8 => 0,
        9 => 30,
        10 => 60,
        11 => 90,
        12 => 150,
        13 => 180,
        14 => 210,
        _ => 240,
    });
    assert_eq!(sharp.sample_count, blurred.sample_count);
    assert!(sharp.gradient_squared_sum > blurred.gradient_squared_sum);
    assert_eq!(sharp.assessment, "measured");
    assert_eq!(blurred.assessment, "measured");
}

#[test]
fn all_eight_orientations_have_exact_known_pixel_order() {
    // Encoded layout [10 20 30; 40 50 60]. Labels are grayscale RGB pixels.
    let rgb: Vec<_> = [10, 20, 30, 40, 50, 60]
        .into_iter()
        .flat_map(|value| [value; 3])
        .collect();
    let expected: [&[u8]; 8] = [
        &[10, 20, 30, 40, 50, 60],
        &[30, 20, 10, 60, 50, 40],
        &[60, 50, 40, 30, 20, 10],
        &[40, 50, 60, 10, 20, 30],
        &[10, 40, 20, 50, 30, 60],
        &[40, 10, 50, 20, 60, 30],
        &[60, 30, 50, 20, 40, 10],
        &[30, 60, 20, 50, 10, 40],
    ];
    for orientation in 1..=8 {
        let (actual, width, height) = oriented_luma(&rgb, 3, 2, orientation);
        assert_eq!(actual, expected[orientation as usize - 1]);
        assert_eq!(
            (width, height),
            if orientation < 5 { (3, 2) } else { (2, 3) }
        );
    }
}

#[test]
fn delivered_jpeg_exif_orientation_and_subject_coordinates_are_applied_before_analysis() {
    let base = jpeg(24, 16, |x, y| [(x * 7) as u8, (y * 11) as u8, 80]);
    let baseline = report(&base);
    for orientation in 1..=8 {
        let bytes = with_orientation(&base, orientation);
        let actual = report(&bytes);
        assert_eq!(actual.image.exif_orientation, orientation as u8);
        assert_eq!(
            (actual.image.encoded_width, actual.image.encoded_height),
            (24, 16)
        );
        assert_eq!(
            (actual.image.oriented_width, actual.image.oriented_height),
            if orientation < 5 { (24, 16) } else { (16, 24) }
        );
        assert_eq!(actual.regions[0].exposure, baseline.regions[0].exposure);
        assert_eq!(
            actual.regions[0].sharpness[0].gradient_squared_sum,
            baseline.regions[0].sharpness[0].gradient_squared_sum
        );
    }
    let rotated = with_orientation(&base, 6);
    let only_oriented_valid = CameraQualityProfile {
        subject_region: Some(PixelRegion {
            x: 0,
            y: 17,
            width: 16,
            height: 7,
        }),
        ..CameraQualityProfile::default()
    };
    assert!(analyze_camera_quality_typed(&rotated, &only_oriented_valid).is_ok());
    assert!(analyze_camera_quality_typed(&base, &only_oriented_valid).is_err());
}

#[test]
fn grayscale_jpeg_and_odd_grid_dimensions_are_supported() {
    let pixels = image::GrayImage::from_fn(17, 13, |x, y| image::Luma([(3 * x + 5 * y) as u8]));
    let mut bytes = Vec::new();
    JpegEncoder::new_with_quality(&mut bytes, 100)
        .encode_image(&pixels)
        .unwrap();
    let actual = report(&bytes);
    assert_eq!(
        (actual.image.oriented_width, actual.image.oriented_height),
        (17, 13)
    );
    assert_eq!(actual.regions[0].exposure.sample_count, 17 * 13);
    assert_eq!(
        actual.regions[1..]
            .iter()
            .map(|region| region.exposure.sample_count)
            .sum::<u64>(),
        17 * 13
    );
    assert_eq!(
        actual.regions[4].bounds,
        PixelRegion {
            x: 8,
            y: 6,
            width: 9,
            height: 7
        }
    );
}

#[test]
fn rejects_unknown_profile_fields_versions_regions_and_large_profile_before_decode() {
    let bytes = jpeg(16, 12, |_, _| [128; 3]);
    let mut profile: Value = serde_json::from_str(&camera_quality_profile()).unwrap();
    for invalid in [
        json!({"version":1,"type":"nonverba-camera-quality-profile","metric_profile":METRIC_PROFILE,"score":1}),
        json!({"version":2,"type":"nonverba-camera-quality-profile","metric_profile":METRIC_PROFILE}),
        json!({"version":1,"type":"a-success-proof","metric_profile":METRIC_PROFILE}),
        json!({"version":1,"type":"nonverba-camera-quality-profile","metric_profile":"universal-focus-test"}),
    ] {
        assert!(analyze_camera_quality(&bytes, &invalid.to_string()).is_err());
    }
    for region in [
        json!({"x":0,"y":0,"width":0,"height":4}),
        json!({"x":0,"y":0,"width":17,"height":4}),
        json!({"x":0,"y":10,"width":4,"height":3}),
        json!({"x":u32::MAX,"y":0,"width":4,"height":4}),
        json!({"x":0.5,"y":0,"width":4,"height":4}),
        json!({"x":-1,"y":0,"width":4,"height":4}),
        json!({"x":0,"y":0,"width":4,"height":4,"confidence":1}),
    ] {
        profile["subject_region"] = region;
        assert!(analyze_camera_quality(&bytes, &profile.to_string()).is_err());
    }
    let duplicate = format!("{{\"version\":1,\"version\":1,\"type\":\"nonverba-camera-quality-profile\",\"metric_profile\":\"{METRIC_PROFILE}\"}}");
    assert!(analyze_camera_quality(&bytes, &duplicate).is_err());
    assert!(
        analyze_camera_quality(b"not a JPEG", &" ".repeat(MAX_PROFILE_BYTES + 1))
            .unwrap_err()
            .contains("4096")
    );
}

#[test]
fn rejects_dimension_bombs_before_pixel_allocation() {
    assert!(validate_dimensions(8192, 1464).is_ok());
    for (width, height) in [(0, 1), (1, 0), (8193, 1), (1, 8193), (4000, 4000)] {
        assert!(validate_dimensions(width, height).is_err());
    }
    let bytes = jpeg(8, 8, |_, _| [128; 3]);
    let bomb = replace_dimensions(&bytes, 4000, 4000);
    assert!(analyze_camera_quality(&bomb, &camera_quality_profile())
        .unwrap_err()
        .contains("12 million"));
    let bomb = replace_dimensions(&bytes, 8193, 8);
    assert!(analyze_camera_quality(&bomb, &camera_quality_profile()).is_err());
}

#[test]
fn malformed_jpeg_exif_and_truncated_pixels_are_rejected() {
    let bytes = jpeg(16, 16, |x, y| [(x * 13) as u8, (y * 13) as u8, 80]);
    for invalid in [
        vec![],
        b"\x89PNG\r\n\x1a\n".to_vec(),
        vec![0xff, 0xd8],
        vec![0xff, 0xd8, 0xff, 0xe1, 0, 1],
    ] {
        assert!(analyze_camera_quality(&invalid, &camera_quality_profile()).is_err());
    }
    for orientation in [0, 9, u16::MAX] {
        assert!(analyze_camera_quality(
            &with_orientation(&bytes, orientation),
            &camera_quality_profile()
        )
        .unwrap_err()
        .contains("orientation"));
    }
    let mut duplicate = bytes[..2].to_vec();
    duplicate.extend(exif_segment(1));
    duplicate.extend(exif_segment(1));
    duplicate.extend_from_slice(&bytes[2..]);
    assert!(
        analyze_camera_quality(&duplicate, &camera_quality_profile())
            .unwrap_err()
            .contains("Duplicate")
    );
    let mut malformed_exif = with_orientation(&bytes, 1);
    malformed_exif[12] = b'X'; // TIFF endian header, after Exif\0\0
    assert!(
        analyze_camera_quality(&malformed_exif, &camera_quality_profile())
            .unwrap_err()
            .contains("Exif")
    );
    let scan = bytes
        .windows(2)
        .position(|marker| marker == [0xff, 0xda])
        .unwrap();
    assert!(analyze_camera_quality(&bytes[..scan + 5], &camera_quality_profile()).is_err());
}

#[test]
fn duplicate_or_wrongly_typed_primary_ifd_orientation_is_rejected() {
    let bytes = jpeg(8, 8, |_, _| [128; 3]);
    let segment = exif_segment(1);
    let mut payload = segment[4..].to_vec();
    payload[14..16].copy_from_slice(&2_u16.to_le_bytes());
    let field = payload[16..28].to_vec();
    payload.splice(28..28, field);
    let mut duplicated = bytes[..2].to_vec();
    duplicated.extend([0xff, 0xe1]);
    duplicated.extend(((payload.len() + 2) as u16).to_be_bytes());
    duplicated.extend(payload);
    duplicated.extend_from_slice(&bytes[2..]);
    assert!(
        analyze_camera_quality(&duplicated, &camera_quality_profile())
            .unwrap_err()
            .contains("Duplicate")
    );
    let mut wrongly_typed = with_orientation(&bytes, 1);
    // JPEG prefix2+APP1 prefix4+Exif/TIFF16+tag2 = type field at byte24.
    wrongly_typed[24..26].copy_from_slice(&4_u16.to_le_bytes()); // LONG, not SHORT
    assert!(
        analyze_camera_quality(&wrongly_typed, &camera_quality_profile())
            .unwrap_err()
            .contains("SHORT")
    );
}

#[test]
fn big_endian_exif_orientation_uses_the_same_pixel_coordinate_contract() {
    let bytes = jpeg(24, 16, |x, y| [(x * 7) as u8, (y * 11) as u8, 80]);
    let mut payload = b"Exif\0\0MM\0\x2a\0\0\0\x08\0\x01\x01\x12\0\x03\0\0\0\x01".to_vec();
    payload.extend_from_slice(&6_u16.to_be_bytes());
    payload.extend_from_slice(&[0; 6]);
    let mut oriented = bytes[..2].to_vec();
    oriented.extend([0xff, 0xe1]);
    oriented.extend(((payload.len() + 2) as u16).to_be_bytes());
    oriented.extend(payload);
    oriented.extend_from_slice(&bytes[2..]);
    let expected = report(&with_orientation(&bytes, 6));
    let actual = report(&oriented);
    assert_ne!(actual.image_sha256, expected.image_sha256);
    assert_eq!(actual.image, expected.image);
    assert_eq!(actual.regions, expected.regions);
}

#[test]
fn nyquist_checkerboard_has_range_but_no_measurable_sobel_texture() {
    let pixels: Vec<u8> = (0..64)
        .map(|index| {
            if (index % 8 + index / 8) % 2 == 0 {
                0
            } else {
                255
            }
        })
        .collect();
    let actual = measure_region(
        "checkerboard",
        PixelRegion {
            x: 0,
            y: 0,
            width: 8,
            height: 8,
        },
        &pixels,
        8,
    );
    assert_eq!(actual.exposure.range, 255);
    assert_eq!(actual.sharpness[0].sample_count, 36);
    assert_eq!(actual.sharpness[0].assessment, "insufficient-texture");
    assert_eq!(actual.sharpness[0].gradient_squared_sum, 0);
}

#[test]
fn rejects_input_over_byte_bound_before_metadata_or_pixels() {
    let mut over_limit = vec![0; MAX_IMAGE_BYTES + 1];
    over_limit[..2].copy_from_slice(&[0xff, 0xd8]);
    assert!(
        analyze_camera_quality(&over_limit, &camera_quality_profile())
            .unwrap_err()
            .contains("32 MiB")
    );
}
