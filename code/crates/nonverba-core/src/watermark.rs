// SPDX-License-Identifier: AGPL-3.0-only
//! Version 1 pixel lookup watermark. Apply this BEFORE hashing or C2PA signing.
//!
//! A repeated 128-bit packet (version marker, 64-bit lookup ID, CRC-32) is encoded
//! by quantizing one mid-frequency luminance DCT coefficient per 8x8 block.
//! The packet survives metadata removal and ordinary JPEG recompression. It is
//! not a signature or evidence of authenticity: anyone can copy or replace it.
//! Cropping, rotation, scaling, heavy compression and screenshots are not
//! supported. Always verify the recovered record's C2PA binding separately.

use image::{codecs::jpeg::JpegEncoder, ImageFormat, ImageReader, Limits, RgbImage};
use std::io::Cursor;

const MAGIC: [u8; 4] = *b"NVW1";
const PACKET_BITS: usize = 128;
const STEP: f32 = 24.0;
const JPEG_QUALITY: u8 = 92;
const MAX_DIMENSION: u32 = 8192;
const MAX_PIXELS: u64 = 16_777_216;
const MAX_INPUT_BYTES: usize = 32 * 1024 * 1024;

/// A non-cryptographic hint for finding a provenance record.
#[derive(Clone, Debug, PartialEq)]
pub struct Watermark {
    pub id: [u8; 8],
    /// Mean agreement of repeated observations, from 0 to 1. This is NOT the
    /// probability that an image, signer, or provenance claim is authentic.
    pub confidence: f32,
}

/// Decode a JPEG, add a subtle pixel watermark, and encode at quality 92.
///
/// Metadata is deliberately discarded. The caller must normalize orientation
/// before this operation and create the C2PA manifest afterwards. The input must
/// be at least 256x256, no more than 8192 on either axis or 16 megapixels total.
/// The ID should be generated randomly or derived from a collision-resistant
/// capture identifier, never from identifying personal information.
pub fn embed(jpeg: &[u8], id: [u8; 8]) -> Result<Vec<u8>, String> {
    let mut rgb = decode(jpeg)?;
    let packet = packet(id);
    apply_packet(&mut rgb, &packet);
    let encoded = encode(&rgb, JPEG_QUALITY)?;
    drop(rgb);
    // Clipped highlights/shadows can suppress a coefficient. Do not issue an
    // apparently successful capture if its actual output cannot be recovered.
    let recovered = extract(&encoded).map_err(|_| {
        "Image cannot carry a reliable watermark; try a better-lit capture".to_owned()
    })?;
    if recovered.id != id {
        return Err("Watermark did not survive JPEG encoding".to_owned());
    }
    Ok(encoded)
}

/// Recover a lookup ID from pixels. Failure means absent or damaged watermark;
/// it says nothing about whether C2PA credentials are present or valid.
pub fn extract(jpeg: &[u8]) -> Result<Watermark, String> {
    let rgb = decode(jpeg)?;
    let basis = basis();
    let mut sums = [0.0_f32; PACKET_BITS];
    let mut counts = [0_u32; PACKET_BITS];
    let mut block = 0_usize;
    for by in 0..rgb.height() / 8 {
        for bx in 0..rgb.width() / 8 {
            let coordinate = coefficient(&rgb, bx * 8, by * 8, &basis) / STEP;
            let nearest = coordinate.round();
            let bit = ((nearest as i32 & 1) as u8) ^ mask(block);
            // Near a quantizer boundary, an observation has little evidence.
            let weight = (1.0 - 2.0 * (coordinate - nearest).abs()).max(0.0);
            let index = packet_index(block);
            sums[index] += if bit == 1 { weight } else { -weight };
            counts[index] += 1;
            block += 1;
        }
    }
    let mut packet = [0_u8; PACKET_BITS / 8];
    let mut confidence = 0.0;
    for i in 0..PACKET_BITS {
        if counts[i] < 8 || sums[i] == 0.0 {
            return Err("No reliable pixel watermark found".to_owned());
        }
        if sums[i] > 0.0 {
            packet[i / 8] |= 1 << (7 - i % 8);
        }
        confidence += sums[i].abs() / counts[i] as f32;
    }
    confidence /= PACKET_BITS as f32;
    let crc = crc32(&packet[..12]).to_be_bytes();
    if packet[..4] != MAGIC || packet[12..] != crc || confidence < 0.35 {
        return Err("No reliable pixel watermark found (absent or damaged)".to_owned());
    }
    let mut id = [0_u8; 8];
    id.copy_from_slice(&packet[4..12]);
    Ok(Watermark { id, confidence })
}

fn decode(jpeg: &[u8]) -> Result<RgbImage, String> {
    if jpeg.len() > MAX_INPUT_BYTES {
        return Err("JPEG exceeds the 32 MiB input limit".to_owned());
    }
    if !jpeg.starts_with(&[0xff, 0xd8]) {
        return Err("Pixel watermark requires a JPEG image".to_owned());
    }
    // Read dimensions without allocating decoded pixels. Check the product as
    // well as each axis: decoder allocation limits alone are only best effort.
    let (width, height) = ImageReader::with_format(Cursor::new(jpeg), ImageFormat::Jpeg)
        .into_dimensions()
        .map_err(|error| format!("Invalid JPEG header: {error}"))?;
    validate_dimensions(width, height)?;
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_DIMENSION);
    limits.max_image_height = Some(MAX_DIMENSION);
    limits.max_alloc = Some(128 * 1024 * 1024);
    let mut reader = ImageReader::with_format(Cursor::new(jpeg), ImageFormat::Jpeg);
    reader.limits(limits);
    reader
        .decode()
        .map(|image| image.to_rgb8())
        .map_err(|error| format!("Could not decode JPEG: {error}"))
}

fn validate_dimensions(width: u32, height: u32) -> Result<(), String> {
    if width < 256 || height < 256 {
        return Err("Pixel watermark requires at least 256x256 pixels".to_owned());
    }
    if width > MAX_DIMENSION
        || height > MAX_DIMENSION
        || u64::from(width) * u64::from(height) > MAX_PIXELS
    {
        return Err("JPEG exceeds the 8192-pixel axis or 16-megapixel limit".to_owned());
    }
    Ok(())
}

fn encode(rgb: &RgbImage, quality: u8) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    JpegEncoder::new_with_quality(&mut out, quality)
        .encode_image(rgb)
        .map_err(|error| format!("Could not encode JPEG: {error}"))?;
    Ok(out)
}

fn packet(id: [u8; 8]) -> [u8; PACKET_BITS / 8] {
    let mut packet = [0_u8; PACKET_BITS / 8];
    packet[..4].copy_from_slice(&MAGIC);
    packet[4..12].copy_from_slice(&id);
    let crc = crc32(&packet[..12]).to_be_bytes();
    packet[12..].copy_from_slice(&crc);
    packet
}

fn apply_packet(rgb: &mut RgbImage, packet: &[u8; PACKET_BITS / 8]) {
    let basis = basis();
    let mut block = 0_usize;
    for by in 0..rgb.height() / 8 {
        for bx in 0..rgb.width() / 8 {
            let x = bx * 8;
            let y = by * 8;
            let index = packet_index(block);
            let bit = ((packet[index / 8] >> (7 - index % 8)) & 1) ^ mask(block);
            let current = coefficient(rgb, x, y, &basis);
            let target = (((current / STEP - bit as f32) / 2.0).round() * 2.0 + bit as f32) * STEP;
            let delta = target - current;
            for py in 0..8 {
                for px in 0..8 {
                    let change = delta * basis[py * 8 + px];
                    let pixel = rgb.get_pixel_mut(x + px as u32, y + py as u32);
                    // Equal changes to R,G,B adjust luminance while preserving
                    // chroma except at saturated channel boundaries.
                    for channel in pixel.0.iter_mut() {
                        *channel = (*channel as f32 + change).round().clamp(0.0, 255.0) as u8;
                    }
                }
            }
            block += 1;
        }
    }
}

// Orthonormal 8x8 DCT basis at (u=2,v=3). A one-coefficient update needs no
// general DCT library and has constant memory and linear pixel-time cost.
fn basis() -> [f32; 64] {
    let mut basis = [0.0_f32; 64];
    for y in 0..8 {
        for x in 0..8 {
            basis[y * 8 + x] = 0.25
                * (std::f32::consts::PI * (2 * x + 1) as f32 * 2.0 / 16.0).cos()
                * (std::f32::consts::PI * (2 * y + 1) as f32 * 3.0 / 16.0).cos();
        }
    }
    basis
}

fn coefficient(rgb: &RgbImage, x: u32, y: u32, basis: &[f32; 64]) -> f32 {
    let mut coefficient = 0.0;
    for py in 0..8 {
        for px in 0..8 {
            let pixel = rgb.get_pixel(x + px as u32, y + py as u32).0;
            let luminance =
                0.299 * pixel[0] as f32 + 0.587 * pixel[1] as f32 + 0.114 * pixel[2] as f32;
            coefficient += (luminance - 128.0) * basis[py * 8 + px];
        }
    }
    coefficient
}

fn packet_index(block: usize) -> usize {
    (block * 73) % PACKET_BITS
}

// Public, deterministic whitening disperses visible repetition. This is not a
// secret key, encryption, or protection against deliberately forged watermarks.
fn mask(block: usize) -> u8 {
    let mut value = (block as u32).wrapping_add(0x9e37_79b9);
    value ^= value >> 16;
    value = value.wrapping_mul(0x85eb_ca6b);
    value ^= value >> 13;
    value = value.wrapping_mul(0xc2b2_ae35);
    value ^= value >> 16;
    (value & 1) as u8
}

fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = !0_u32;
    for byte in bytes {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            crc = (crc >> 1) ^ (0xedb8_8320_u32 & 0_u32.wrapping_sub(crc & 1));
        }
    }
    !crc
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgb;

    fn fixture(width: u32, height: u32, seed: u32) -> RgbImage {
        let mut random = seed;
        RgbImage::from_fn(width, height, |x, y| {
            random ^= random << 13;
            random ^= random >> 17;
            random ^= random << 5;
            let texture = (random % 13) as f32 - 6.0;
            let hills = 18.0 * (x as f32 / 27.0).sin() + 16.0 * (y as f32 / 37.0).cos();
            let base = 40.0 + 120.0 * y as f32 / height as f32 + hills + texture;
            Rgb([
                (base + 20.0 + 20.0 * x as f32 / width as f32).clamp(0.0, 255.0) as u8,
                (base + 30.0).clamp(0.0, 255.0) as u8,
                (base + 10.0).clamp(0.0, 255.0) as u8,
            ])
        })
    }

    fn psnr(left: &RgbImage, right: &RgbImage) -> f64 {
        let mse = left
            .as_raw()
            .iter()
            .zip(right.as_raw())
            .map(|(a, b)| (f64::from(*a) - f64::from(*b)).powi(2))
            .sum::<f64>()
            / left.as_raw().len() as f64;
        10.0 * (255.0 * 255.0 / mse).log10()
    }

    #[test]
    fn jpeg_roundtrip_is_deterministic_and_subtle() {
        let original = encode(&fixture(640, 480, 0x1234_5678), 95).unwrap();
        let id = [0xa5, 0x2c, 0xe1, 0x04, 0x92, 0xff, 0x70, 0x18];
        let marked = embed(&original, id).unwrap();
        assert_eq!(marked, embed(&original, id).unwrap());
        let extracted = extract(&marked).unwrap();
        assert_eq!(extracted.id, id);
        assert!(extracted.confidence > 0.65, "{extracted:?}");
        let quality = psnr(&decode(&original).unwrap(), &decode(&marked).unwrap());
        assert!(quality > 35.0, "PSNR {quality:.2} dB");
        eprintln!(
            "watermark PSNR={quality:.2} dB confidence={:.3}",
            extracted.confidence
        );
    }

    #[test]
    fn survives_quality85_recompression_and_metadata_loss() {
        for seed in [7, 0x9876_4321] {
            let original = encode(&fixture(640, 480, seed), 95).unwrap();
            let id = [0, 1, 2, 3, 4, 5, 6, seed as u8];
            let marked = embed(&original, id).unwrap();
            // Decoding and re-encoding removes every original metadata segment.
            let recompressed = encode(&decode(&marked).unwrap(), 85).unwrap();
            assert_eq!(extract(&recompressed).unwrap().id, id);
        }
    }

    #[test]
    fn works_at_minimum_dimensions_and_non_block_multiple_edges() {
        for (width, height) in [(256, 256), (641, 481)] {
            let source = encode(&fixture(width, height, 42), 95).unwrap();
            let id = *b"min-size";
            let marked = embed(&source, id).unwrap();
            let recompressed = encode(&decode(&marked).unwrap(), 85).unwrap();
            assert_eq!(extract(&recompressed).unwrap().id, id);
        }
    }

    #[test]
    fn unmarked_images_do_not_report_a_record() {
        for seed in [1, 3, 17, 81] {
            assert!(extract(&encode(&fixture(640, 480, seed), 92).unwrap()).is_err());
        }
        for value in [0, 127, 255] {
            let image = RgbImage::from_pixel(256, 256, Rgb([value; 3]));
            assert!(extract(&encode(&image, 92).unwrap()).is_err());
        }
    }

    #[test]
    fn corrupt_payload_is_rejected_even_with_valid_marker() {
        let mut image = fixture(640, 480, 7);
        let mut corrupted = packet(*b"record01");
        corrupted[6] ^= 0x10; // Keep old CRC: this is not a valid packet.
        apply_packet(&mut image, &corrupted);
        assert!(extract(&encode(&image, 92).unwrap()).is_err());
    }

    #[test]
    fn malformed_and_oversize_images_are_rejected() {
        assert!(embed(b"not a JPEG", [0; 8]).is_err());
        assert!(extract(&[0xff, 0xd8, 0, 0]).is_err());
        assert!(validate_dimensions(255, 256).is_err());
        assert!(validate_dimensions(8193, 256).is_err());
        assert!(validate_dimensions(8192, 8192).is_err());
        assert!(validate_dimensions(4096, 4096).is_ok());
        let mut oversized = vec![0_u8; MAX_INPUT_BYTES + 1];
        oversized[..2].copy_from_slice(&[0xff, 0xd8]);
        assert!(extract(&oversized).unwrap_err().contains("32 MiB"));
    }
}
