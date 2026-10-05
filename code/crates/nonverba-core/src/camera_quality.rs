// SPDX-License-Identifier: AGPL-3.0-only
//! Recomputable measurements of delivered JPEG pixels, for guidance only.
//!
//! This report is unsigned, has no acceptance authority and makes no claim about
//! collection, focus, motion, physical causes or responsibility. Its digest binds
//! the supplied image bytes; the normalized profile describes the analysis only.
//! A future signed quality contract must bind that profile to the original request.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

pub const METRIC_PROFILE: &str = "jpeg-rgb8-zune-tenengrad-v1";
pub const MAX_IMAGE_BYTES: usize = 32 * 1024 * 1024;
pub const MAX_DIMENSION: u32 = 8192;
pub const MAX_PIXELS: u64 = 12_000_000;
const MAX_PROFILE_BYTES: usize = 4096;
const SCALES: [u32; 3] = [1, 2, 4];
const NEAR_BLACK: u8 = 5;
const NEAR_WHITE: u8 = 250;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PixelRegion {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CameraQualityProfile {
    pub version: u32,
    #[serde(rename = "type")]
    pub profile_type: String,
    pub metric_profile: String,
    #[serde(default)]
    pub subject_region: Option<PixelRegion>,
}

impl Default for CameraQualityProfile {
    fn default() -> Self {
        Self {
            version: 1,
            profile_type: "nonverba-camera-quality-profile".into(),
            metric_profile: METRIC_PROFILE.into(),
            subject_region: None,
        }
    }
}

impl CameraQualityProfile {
    fn validate(&self) -> Result<(), String> {
        if self.version != 1
            || self.profile_type != "nonverba-camera-quality-profile"
            || self.metric_profile != METRIC_PROFILE
        {
            return Err("Unsupported camera quality profile".into());
        }
        if let Some(region) = &self.subject_region {
            if region.width == 0
                || region.height == 0
                || region.x >= MAX_DIMENSION
                || region.y >= MAX_DIMENSION
                || region.width > MAX_DIMENSION
                || region.height > MAX_DIMENSION
                || region.x.checked_add(region.width).is_none()
                || region.y.checked_add(region.height).is_none()
            {
                return Err("Subject region must contain bounded integer pixels".into());
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CameraQualityReport {
    pub version: u32,
    #[serde(rename = "type")]
    pub report_type: String,
    pub guidance_only: bool,
    pub satisfies_successful_measurement: bool,
    pub authenticity_proven: bool,
    pub image_sha256: String,
    /// SHA-256 of serde_json's compact serialization of `profile`, with fields
    /// in the declared order. It binds normalized semantics, not input whitespace.
    pub analysis_profile_sha256: String,
    pub profile: CameraQualityProfile,
    pub image: ImageDescription,
    pub rules: AnalysisRules,
    pub regions: Vec<RegionMeasurements>,
    pub guidance: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ImageDescription {
    pub byte_length: usize,
    pub encoded_width: u32,
    pub encoded_height: u32,
    pub oriented_width: u32,
    pub oriented_height: u32,
    pub exif_orientation: u8,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AnalysisRules {
    pub decoder: String,
    pub orientation: String,
    pub color_conversion: String,
    pub color_management: String,
    pub grid: String,
    pub scales: [u32; 3],
    pub resize: String,
    pub gradient: String,
    pub texture_assessment: String,
    pub near_black_maximum_inclusive: u8,
    pub near_white_minimum_inclusive: u8,
    pub max_image_bytes: usize,
    pub max_axis_pixels: u32,
    pub max_decoded_pixels: u64,
    pub max_progressive_scans: u32,
}

impl Default for AnalysisRules {
    fn default() -> Self {
        Self {
            decoder: "zune-jpeg=0.5.15/zune-core=0.5.3 default optimized RGB8, strict JPEG, maximum 100 progressive scans; decoder agreement checked on shared fixtures, not guaranteed for every architecture".into(),
            orientation: "one pre-scan Exif APP1, primary IFD Orientation 1..8; absent=1; duplicate or malformed Exif/orientation rejected; subject pixels follow orientation".into(),
            color_conversion: "encoded-luma8=(77*R+150*G+29*B+128)/256, integer floor".into(),
            color_management: "ICC ignored; encoded RGB is not linear light or calibrated scene luminance".into(),
            grid: "2x2 nonempty tiles; boundaries floor(axis*index/2); full frame and optional explicit subject also measured".into(),
            scales: SCALES,
            resize: "per-region nonoverlapping scale x scale box means rounded half up; incomplete right/bottom blocks discarded; scale=1 unchanged".into(),
            gradient: "un-normalized 3x3 Sobel gx=[-1,0,1;-2,0,2;-1,0,1], gy=transpose(gx); sum(gx^2+gy^2); interior centers only, no padding".into(),
            texture_assessment: "insufficient-data if no 3x3 center; insufficient-texture if every measured gradient is zero; otherwise measured, without focus/usability threshold".into(),
            near_black_maximum_inclusive: NEAR_BLACK,
            near_white_minimum_inclusive: NEAR_WHITE,
            max_image_bytes: MAX_IMAGE_BYTES,
            max_axis_pixels: MAX_DIMENSION,
            max_decoded_pixels: MAX_PIXELS,
            max_progressive_scans: 100,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RegionMeasurements {
    pub id: String,
    pub bounds: PixelRegion,
    pub exposure: ExposureMeasurements,
    pub sharpness: Vec<GradientMeasurements>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ExposureMeasurements {
    pub sample_count: u64,
    pub near_black_count: u64,
    pub near_white_count: u64,
    pub histogram: Vec<u64>,
    pub minimum: u8,
    pub maximum: u8,
    pub range: u8,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct GradientMeasurements {
    pub scale: u32,
    pub width: u32,
    pub height: u32,
    pub sample_count: u64,
    pub gradient_squared_sum: u64,
    pub nonzero_gradient_count: u64,
    pub assessment: String,
}

/// Canonical complete default profile. An omitted subject is not guessed.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn camera_quality_profile() -> String {
    serde_json::to_string(&CameraQualityProfile::default())
        .expect("Fixed camera quality profile is serializable")
}

/// Analyze actual delivered JPEG bytes. No time, key or sensor access is needed.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn analyze_camera_quality(image_bytes: &[u8], profile_json: &str) -> Result<String, String> {
    if profile_json.len() > MAX_PROFILE_BYTES {
        return Err("Camera quality profile exceeds 4096 bytes".into());
    }
    let profile: CameraQualityProfile = serde_json::from_str(profile_json)
        .map_err(|error| format!("Invalid camera quality profile: {error}"))?;
    let report = analyze_camera_quality_typed(image_bytes, &profile)?;
    serde_json::to_string(&report).map_err(|error| error.to_string())
}

/// Typed entry point for native callers and shared fixture generators.
pub fn analyze_camera_quality_typed(
    image_bytes: &[u8],
    profile: &CameraQualityProfile,
) -> Result<CameraQualityReport, String> {
    profile.validate()?;
    validate_image_input(image_bytes)?;
    let (rgb, width, height, orientation) = decode(image_bytes, profile.subject_region.as_ref())?;
    let (luma, oriented_width, oriented_height) = oriented_luma(&rgb, width, height, orientation);
    drop(rgb);
    let mut regions = Vec::with_capacity(6);
    regions.push(measure_region(
        "full_frame",
        PixelRegion {
            x: 0,
            y: 0,
            width: oriented_width,
            height: oriented_height,
        },
        &luma,
        oriented_width,
    ));
    for row in 0..2 {
        for column in 0..2 {
            let x = oriented_width * column / 2;
            let y = oriented_height * row / 2;
            let bounds = PixelRegion {
                x,
                y,
                width: oriented_width * (column + 1) / 2 - x,
                height: oriented_height * (row + 1) / 2 - y,
            };
            if bounds.width > 0 && bounds.height > 0 {
                regions.push(measure_region(
                    &format!("grid_{row}_{column}"),
                    bounds,
                    &luma,
                    oriented_width,
                ));
            }
        }
    }
    if let Some(region) = &profile.subject_region {
        regions.push(measure_region(
            "subject",
            region.clone(),
            &luma,
            oriented_width,
        ));
    }
    let mut guidance = Vec::new();
    if profile.subject_region.is_none() {
        guidance.push("subject-region-not-selected".into());
    }
    for region in &regions {
        for metric in &region.sharpness {
            if metric.assessment != "measured" {
                guidance.push(format!(
                    "{}:scale-{}:{}",
                    region.id, metric.scale, metric.assessment
                ));
            }
        }
    }
    let canonical_profile = serde_json::to_vec(profile).map_err(|error| error.to_string())?;
    Ok(CameraQualityReport {
        version: 1,
        report_type: "nonverba-camera-quality-report".into(),
        guidance_only: true,
        satisfies_successful_measurement: false,
        authenticity_proven: false,
        image_sha256: hex::encode(Sha256::digest(image_bytes)),
        analysis_profile_sha256: hex::encode(Sha256::digest(canonical_profile)),
        profile: profile.clone(),
        image: ImageDescription {
            byte_length: image_bytes.len(),
            encoded_width: width,
            encoded_height: height,
            oriented_width,
            oriented_height,
            exif_orientation: orientation,
        },
        rules: AnalysisRules::default(),
        regions,
        guidance,
    })
}

fn validate_image_input(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err("Camera quality JPEG exceeds 32 MiB".into());
    }
    if !bytes.starts_with(&[0xff, 0xd8]) {
        return Err("Camera quality requires JPEG image bytes".into());
    }
    Ok(())
}

fn validate_dimensions(width: usize, height: usize) -> Result<(), String> {
    if width == 0
        || height == 0
        || width > MAX_DIMENSION as usize
        || height > MAX_DIMENSION as usize
        || (width as u64) * (height as u64) > MAX_PIXELS
    {
        return Err("Camera quality JPEG exceeds 8192 pixels per axis or 12 million pixels".into());
    }
    Ok(())
}

fn validate_region(region: &PixelRegion, width: u32, height: u32) -> Result<(), String> {
    if region.width == 0
        || region.height == 0
        || region
            .x
            .checked_add(region.width)
            .is_none_or(|right| right > width)
        || region
            .y
            .checked_add(region.height)
            .is_none_or(|bottom| bottom > height)
    {
        return Err("Subject region is outside the oriented delivered image".into());
    }
    Ok(())
}

// Decoder configuration is kept here so its exact pinned behavior can be audited.
// The dimension product is checked after header parsing and BEFORE pixel decoding.
fn decode(
    bytes: &[u8],
    subject_region: Option<&PixelRegion>,
) -> Result<(Vec<u8>, u32, u32, u8), String> {
    let orientation = exif_orientation(bytes)?;
    let options = zune_core::options::DecoderOptions::default()
        .set_max_width(MAX_DIMENSION as usize)
        .set_max_height(MAX_DIMENSION as usize)
        .set_strict_mode(true)
        .jpeg_set_max_scans(100)
        .jpeg_set_out_colorspace(zune_core::colorspace::ColorSpace::RGB);
    let mut decoder = zune_jpeg::JpegDecoder::new_with_options(
        zune_core::bytestream::ZCursor::new(bytes),
        options,
    );
    decoder
        .decode_headers()
        .map_err(|error| format!("Invalid JPEG header: {error}"))?;
    let (width, height) = decoder.dimensions().ok_or("Missing JPEG dimensions")?;
    validate_dimensions(width, height)?;
    if let Some(region) = subject_region {
        let (oriented_width, oriented_height) = if orientation >= 5 {
            (height, width)
        } else {
            (width, height)
        };
        validate_region(region, oriented_width as u32, oriented_height as u32)?;
    }
    if !matches!(
        decoder.input_colorspace(),
        Some(
            zune_core::colorspace::ColorSpace::RGB
                | zune_core::colorspace::ColorSpace::YCbCr
                | zune_core::colorspace::ColorSpace::Luma
        )
    ) {
        return Err("Camera quality supports only RGB, YCbCr or grayscale JPEGs".into());
    }
    let expected_bytes = width * height * 3;
    if decoder.output_buffer_size() != Some(expected_bytes) {
        return Err("Unexpected JPEG RGB output size".into());
    }
    let rgb = decoder
        .decode()
        .map_err(|error| format!("Could not decode JPEG: {error}"))?;
    if rgb.len() != expected_bytes {
        return Err("Unexpected decoded JPEG RGB length".into());
    }
    Ok((rgb, width as u32, height as u32, orientation))
}

/// Parse only JPEG metadata segments before the first scan. The encoded input is
/// bounded; each TIFF slice is at most one APP1 segment. Multiple Exif records or
/// primary-IFD orientation fields are rejected rather than choosing ambiguously.
fn exif_orientation(bytes: &[u8]) -> Result<u8, String> {
    let mut offset = 2;
    let mut seen_exif = false;
    let mut orientation = 1;
    while offset < bytes.len() {
        if bytes[offset] != 0xff {
            return Err("Invalid JPEG metadata marker".into());
        }
        while offset < bytes.len() && bytes[offset] == 0xff {
            offset += 1;
        }
        let marker = *bytes.get(offset).ok_or("Truncated JPEG marker")?;
        offset += 1;
        if marker == 0xda || marker == 0xd9 {
            return Ok(orientation);
        }
        if marker == 0x00 || marker == 0xd8 || (0xd0..=0xd7).contains(&marker) {
            return Err("Unexpected JPEG metadata marker".into());
        }
        if marker == 0x01 {
            continue;
        }
        let length_bytes = bytes
            .get(offset..offset + 2)
            .ok_or("Truncated JPEG segment")?;
        let length = u16::from_be_bytes([length_bytes[0], length_bytes[1]]) as usize;
        if length < 2 {
            return Err("Invalid JPEG segment length".into());
        }
        let end = offset
            .checked_add(length)
            .filter(|end| *end <= bytes.len())
            .ok_or("Truncated JPEG segment payload")?;
        let payload = &bytes[offset + 2..end];
        if marker == 0xe1 && payload.starts_with(b"Exif\0\0") {
            if seen_exif {
                return Err("Duplicate JPEG Exif records are ambiguous".into());
            }
            seen_exif = true;
            let metadata = exif::Reader::new()
                .read_raw(payload[6..].to_vec())
                .map_err(|error| format!("Invalid JPEG Exif: {error}"))?;
            let fields: Vec<_> = metadata
                .fields()
                .filter(|field| {
                    field.tag == exif::Tag::Orientation && field.ifd_num == exif::In::PRIMARY
                })
                .collect();
            if fields.len() > 1 {
                return Err("Duplicate Exif orientations are ambiguous".into());
            }
            if let Some(field) = fields.first() {
                let exif::Value::Short(values) = &field.value else {
                    return Err("Exif orientation must be one SHORT value".into());
                };
                if values.len() != 1 || !(1..=8).contains(&values[0]) {
                    return Err("Exif orientation must be between 1 and 8".into());
                }
                orientation = values[0] as u8;
            }
        }
        offset = end;
    }
    Err("JPEG has no image scan".into())
}

fn encoded_luma(red: u8, green: u8, blue: u8) -> u8 {
    ((77 * u32::from(red) + 150 * u32::from(green) + 29 * u32::from(blue) + 128) / 256) as u8
}

fn oriented_luma(rgb: &[u8], width: u32, height: u32, orientation: u8) -> (Vec<u8>, u32, u32) {
    let (out_width, out_height) = if orientation >= 5 {
        (height, width)
    } else {
        (width, height)
    };
    let mut luma = vec![0; (out_width * out_height) as usize];
    for y in 0..height {
        for x in 0..width {
            let (out_x, out_y) = match orientation {
                1 => (x, y),
                2 => (width - 1 - x, y),
                3 => (width - 1 - x, height - 1 - y),
                4 => (x, height - 1 - y),
                5 => (y, x),
                6 => (height - 1 - y, x),
                7 => (height - 1 - y, width - 1 - x),
                8 => (y, width - 1 - x),
                _ => unreachable!("Exif orientation validated before pixels"),
            };
            let index = ((y * width + x) * 3) as usize;
            luma[(out_y * out_width + out_x) as usize] =
                encoded_luma(rgb[index], rgb[index + 1], rgb[index + 2]);
        }
    }
    (luma, out_width, out_height)
}

fn measure_region(id: &str, bounds: PixelRegion, luma: &[u8], stride: u32) -> RegionMeasurements {
    let mut histogram = vec![0_u64; 256];
    for y in bounds.y..bounds.y + bounds.height {
        for x in bounds.x..bounds.x + bounds.width {
            histogram[luma[(y * stride + x) as usize] as usize] += 1;
        }
    }
    // Every region is nonempty by construction or prior validation.
    let minimum = histogram.iter().position(|count| *count > 0).unwrap() as u8;
    let maximum = histogram.iter().rposition(|count| *count > 0).unwrap() as u8;
    let exposure = ExposureMeasurements {
        sample_count: u64::from(bounds.width) * u64::from(bounds.height),
        near_black_count: histogram[..=NEAR_BLACK as usize].iter().sum(),
        near_white_count: histogram[NEAR_WHITE as usize..].iter().sum(),
        histogram,
        minimum,
        maximum,
        range: maximum - minimum,
    };
    let sharpness = SCALES
        .into_iter()
        .map(|scale| {
            let width = bounds.width / scale;
            let height = bounds.height / scale;
            if scale == 1 {
                measure_gradients(width, height, scale, |x, y| {
                    luma[((bounds.y + y) * stride + bounds.x + x) as usize]
                })
            } else {
                let scaled = box_average(luma, stride, &bounds, scale);
                measure_gradients(width, height, scale, |x, y| {
                    scaled[(y * width + x) as usize]
                })
            }
        })
        .collect();
    RegionMeasurements {
        id: id.into(),
        bounds,
        exposure,
        sharpness,
    }
}

fn box_average(luma: &[u8], stride: u32, region: &PixelRegion, scale: u32) -> Vec<u8> {
    let width = region.width / scale;
    let height = region.height / scale;
    let divisor = scale * scale;
    let mut output = Vec::with_capacity((width * height) as usize);
    for y in 0..height {
        for x in 0..width {
            let mut sum = 0_u32;
            for dy in 0..scale {
                for dx in 0..scale {
                    sum += u32::from(
                        luma[((region.y + y * scale + dy) * stride + region.x + x * scale + dx)
                            as usize],
                    );
                }
            }
            output.push(((sum + divisor / 2) / divisor) as u8);
        }
    }
    output
}

fn measure_gradients(
    width: u32,
    height: u32,
    scale: u32,
    pixel: impl Fn(u32, u32) -> u8,
) -> GradientMeasurements {
    let mut sample_count = 0;
    let mut gradient_squared_sum = 0;
    let mut nonzero_gradient_count = 0;
    for y in 1..height.saturating_sub(1) {
        for x in 1..width.saturating_sub(1) {
            let a = i32::from(pixel(x - 1, y - 1));
            let b = i32::from(pixel(x, y - 1));
            let c = i32::from(pixel(x + 1, y - 1));
            let d = i32::from(pixel(x - 1, y));
            let f = i32::from(pixel(x + 1, y));
            let g = i32::from(pixel(x - 1, y + 1));
            let h = i32::from(pixel(x, y + 1));
            let i = i32::from(pixel(x + 1, y + 1));
            let gx = -a + c - 2 * d + 2 * f - g + i;
            let gy = -a - 2 * b - c + g + 2 * h + i;
            let squared = (gx * gx + gy * gy) as u64;
            sample_count += 1;
            gradient_squared_sum += squared;
            nonzero_gradient_count += u64::from(squared > 0);
        }
    }
    let assessment = if sample_count == 0 {
        "insufficient-data"
    } else if nonzero_gradient_count == 0 {
        "insufficient-texture"
    } else {
        "measured"
    };
    GradientMeasurements {
        scale,
        width,
        height,
        sample_count,
        gradient_squared_sum,
        nonzero_gradient_count,
        assessment: assessment.into(),
    }
}

#[cfg(test)]
mod tests;
