// SPDX-License-Identifier: AGPL-3.0-only
//! Small synthetic JPEG corpus for exact native/WASM agreement, not device evidence.
use image::{codecs::jpeg::JpegEncoder, Rgb, RgbImage};
use nonverba_core::camera_quality::{analyze_camera_quality, camera_quality_profile};
use nonverba_core::{
    create_challenge, create_identity, identity_fingerprint, seal_image, verify_image,
};
use serde_json::{json, Value};
use std::{fs, io::Write, path::Path};

fn write_new(path: &Path, bytes: &[u8]) {
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .unwrap()
        .write_all(bytes)
        .unwrap();
}

fn jpeg(image: &RgbImage) -> Vec<u8> {
    let mut bytes = Vec::new();
    JpegEncoder::new_with_quality(&mut bytes, 95)
        .encode_image(image)
        .unwrap();
    bytes
}

fn orientation(jpeg: &[u8], value: u16) -> Vec<u8> {
    let mut tiff = b"II\x2a\x00\x08\x00\x00\x00\x01\x00\x12\x01\x03\x00\x01\x00\x00\x00".to_vec();
    tiff.extend_from_slice(&value.to_le_bytes());
    tiff.extend_from_slice(&[0; 6]);
    let mut payload = b"Exif\0\0".to_vec();
    payload.extend_from_slice(&tiff);
    let mut result = jpeg[..2].to_vec();
    result.extend_from_slice(&[0xff, 0xe1]);
    result.extend_from_slice(&((payload.len() + 2) as u16).to_be_bytes());
    result.extend_from_slice(&payload);
    result.extend_from_slice(&jpeg[2..]);
    result
}

fn add_case(out: &Path, cases: &mut Vec<Value>, name: &str, bytes: &[u8], profile: &Value) {
    let file = format!("{name}.jpg");
    write_new(&out.join(&file), bytes);
    let profile_json = serde_json::to_string(profile).unwrap();
    let outcome = match analyze_camera_quality(bytes, &profile_json) {
        Ok(report) => json!({"report": serde_json::from_str::<Value>(&report).unwrap()}),
        Err(error) => json!({"error": error}),
    };
    cases.push(json!({"name": name, "file": file, "profile": profile, "outcome": outcome}));
}

fn main() {
    let directory = std::env::args()
        .nth(1)
        .expect("Pass a fresh fixture output directory");
    let out = Path::new(&directory);
    fs::create_dir_all(out).unwrap();
    let profile: Value = serde_json::from_str(&camera_quality_profile()).unwrap();
    let mut cases = Vec::new();
    for (name, level) in [
        ("uniform-gray", 128),
        ("uniform-black", 0),
        ("uniform-white", 255),
    ] {
        let bytes = jpeg(&RgbImage::from_pixel(64, 48, Rgb([level; 3])));
        add_case(out, &mut cases, name, &bytes, &profile);
    }
    let clipping = jpeg(&RgbImage::from_fn(64, 48, |x, _| {
        let level = if x < 32 { 0 } else { 255 };
        Rgb([level; 3])
    }));
    add_case(out, &mut cases, "clipped-halves", &clipping, &profile);
    let textured = RgbImage::from_fn(192, 160, |x, y| {
        let level = if ((x / 4) + (y / 4)) % 2 == 0 {
            32
        } else {
            224
        };
        Rgb([level; 3])
    });
    let sharp = jpeg(&textured);
    add_case(out, &mut cases, "sharp-texture", &sharp, &profile);
    let blurred = RgbImage::from_fn(192, 160, |x, y| {
        let mut sum = 0_u32;
        let mut count = 0_u32;
        for dy in -4_i32..=4 {
            for dx in -4_i32..=4 {
                let px = (x as i32 + dx).clamp(0, 191) as u32;
                let py = (y as i32 + dy).clamp(0, 159) as u32;
                sum += u32::from(textured.get_pixel(px, py).0[0]);
                count += 1;
            }
        }
        Rgb([((sum + count / 2) / count) as u8; 3])
    });
    add_case(
        out,
        &mut cases,
        "blurred-texture",
        &jpeg(&blurred),
        &profile,
    );
    let trap = jpeg(&RgbImage::from_fn(192, 160, |x, y| {
        if (64..128).contains(&x) && (64..128).contains(&y) {
            Rgb([128; 3])
        } else {
            *textured.get_pixel(x, y)
        }
    }));
    let mut subject = profile.clone();
    subject["subject_region"] = json!({"x": 72, "y": 72, "width": 48, "height": 48});
    add_case(
        out,
        &mut cases,
        "flat-subject-textured-background",
        &trap,
        &subject,
    );
    let asymmetric = jpeg(&RgbImage::from_fn(64, 48, |x, y| {
        Rgb([(x * 3 + y) as u8, (y * 4) as u8, (x + y * 2) as u8])
    }));
    for value in 1..=8 {
        add_case(
            out,
            &mut cases,
            &format!("orientation-{value}"),
            &orientation(&asymmetric, value),
            &profile,
        );
    }
    let chroma = jpeg(&RgbImage::from_fn(77, 53, |x, y| {
        Rgb([
            ((x * 37 + y * 13) % 256) as u8,
            if (x + y) % 2 == 0 { 0 } else { 255 },
            ((x * 11 + y * 47) % 256) as u8,
        ])
    }));
    add_case(out, &mut cases, "odd-color-chroma", &chroma, &profile);
    let gray = image::GrayImage::from_fn(77, 53, |x, y| {
        image::Luma([((x * 17 + y * 29) % 256) as u8])
    });
    let mut gray_jpeg = Vec::new();
    JpegEncoder::new_with_quality(&mut gray_jpeg, 95)
        .encode(
            gray.as_raw(),
            gray.width(),
            gray.height(),
            image::ExtendedColorType::L8,
        )
        .unwrap();
    add_case(out, &mut cases, "grayscale-jpeg", &gray_jpeg, &profile);
    // Reviewed upstream synthetic regression fixture; attribution and selected
    // Zlib license are retained beside its exact hex bytes.
    let progressive = hex::decode(
        include_str!("../tests/fixtures/camera-quality/progressive-dri-420.hex.txt").trim(),
    )
    .unwrap();
    add_case(
        out,
        &mut cases,
        "progressive-dri-420",
        &progressive,
        &profile,
    );
    add_case(
        out,
        &mut cases,
        "one-pixel",
        &jpeg(&RgbImage::from_pixel(1, 1, Rgb([128; 3]))),
        &profile,
    );
    let mut invalid_roi = profile.clone();
    invalid_roi["subject_region"] = json!({"x": 190, "y": 0, "width": 20, "height": 10});
    add_case(out, &mut cases, "outside-roi", &sharp, &invalid_roi);
    let mut unknown = profile.clone();
    unknown["invented_threshold"] = json!(100);
    add_case(out, &mut cases, "unknown-profile-field", &sharp, &unknown);
    let mut future = profile.clone();
    future["version"] = json!(2);
    add_case(out, &mut cases, "unsupported-profile", &sharp, &future);
    add_case(out, &mut cases, "malformed-jpeg", b"not a JPEG", &profile);
    // Actual software-signed C2PA output, with synthetic pixels/location/clocks.
    // Private signing material stays in memory and is never written to fixtures.
    let now = 2_000_000_000_f64;
    let challenge = create_challenge(
        "Synthetic quality fixture",
        "Inspect the generated image",
        now,
        300,
    )
    .unwrap();
    let identity = create_identity().unwrap();
    let pin = identity_fingerprint(&identity).unwrap();
    let capture_input = jpeg(&RgbImage::from_fn(640, 480, |x, y| {
        Rgb([
            (48 + x / 4 % 160) as u8,
            (48 + y / 3 % 160) as u8,
            (64 + (x + y) / 5 % 128) as u8,
        ])
    }));
    let location = json!({"latitude":0.0,"longitude":0.0,"accuracy_m":12.25,
        "altitude_m":null,"altitude_accuracy_m":null,
        "timestamp_ms":(now + 2.0) * 1000.0,"source":"device-geolocation"})
    .to_string();
    let sealed = futures::executor::block_on(seal_image(
        &capture_input,
        &challenge,
        &identity,
        now + 2.0,
        &location,
    ))
    .unwrap();
    let signed_verification: Value = serde_json::from_str(
        &futures::executor::block_on(verify_image(&sealed, &challenge, &pin, now + 3.0)).unwrap(),
    )
    .unwrap();
    assert_eq!(signed_verification["verified"], true);
    add_case(out, &mut cases, "delivered-c2pa-jpeg", &sealed, &profile);
    write_new(&out.join("native.json"), &serde_json::to_vec_pretty(&json!({
        "type": "nonverba-camera-quality-synthetic-corpus", "version": 1,
        "scope": "Synthetic delivered-image analysis; no physical collection or signed acceptance",
        "default_profile": profile, "cases": cases,
        "signed_fixture": {"file":"delivered-c2pa-jpeg.jpg","challenge_json":challenge,
            "pin":pin,"verification_time":now + 3.0,"native_verified":true,
            "scope":"Ephemeral software signing; synthetic pixels, GPS and time; no physical acquisition"}
    })).unwrap());
    println!(
        "Saved {} synthetic quality cases in {}",
        cases.len(),
        out.display()
    );
}
