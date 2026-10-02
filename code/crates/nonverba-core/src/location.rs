// SPDX-License-Identifier: AGPL-3.0-only
//! Device-reported WGS84 fixes and standard Exif GPS metadata. A signature binds
//! this report to the image; it cannot authenticate the positioning sensor.

use std::io::Cursor;

use chrono::{DateTime, Datelike, Timelike, Utc};
use exif::{Context, In, Tag, Value};
use serde::{Deserialize, Serialize};

use crate::{challenge_at, err, Challenge};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Location {
    pub latitude: f64,
    pub longitude: f64,
    pub accuracy_m: f64,
    /// Meters above the WGS84 ellipsoid, as defined by W3C Geolocation.
    pub altitude_m: Option<f64>,
    pub altitude_accuracy_m: Option<f64>,
    pub timestamp_ms: f64,
    pub source: String,
}

impl Location {
    pub(crate) fn validate(&self, challenge: &Challenge, captured_at: u64) -> Result<(), String> {
        challenge_at(challenge, captured_at)?;
        if !self.latitude.is_finite()
            || !(-90.0..=90.0).contains(&self.latitude)
            || !self.longitude.is_finite()
            || !(-180.0..=180.0).contains(&self.longitude)
        {
            return Err("Location latitude or longitude is invalid".into());
        }
        if !self.accuracy_m.is_finite() || self.accuracy_m < 0.0 {
            return Err("Location accuracy must be finite and nonnegative".into());
        }
        if self.altitude_m.is_some_and(|value| !value.is_finite())
            || self
                .altitude_accuracy_m
                .is_some_and(|value| !value.is_finite() || value < 0.0)
            || (self.altitude_accuracy_m.is_some() && self.altitude_m.is_none())
        {
            return Err("Location altitude or altitude accuracy is invalid".into());
        }
        if self.source != "device-geolocation" {
            return Err("Location must be a device-geolocation report".into());
        }
        if !self.timestamp_ms.is_finite()
            || self.timestamp_ms < 0.0
            || self.timestamp_ms.fract() != 0.0
            || self.timestamp_ms > 9_007_199_254_740_991.0
        {
            return Err("Location timestamp must be nonnegative integer Unix milliseconds".into());
        }
        let capture_ms = captured_at
            .checked_mul(1000)
            .ok_or("Capture time is too large")?;
        let issued_ms = challenge
            .issued_at
            .checked_mul(1000)
            .ok_or("Challenge time is too large")?;
        let timestamp_ms = self.timestamp_ms as u64;
        if timestamp_ms < issued_ms {
            return Err("Location fix predates the requester challenge".into());
        }
        // Capture time is whole seconds; a fix in that same second can appear
        // up to 999 milliseconds ahead. No wider future-clock tolerance applies.
        if timestamp_ms > capture_ms.saturating_add(1000) {
            return Err("Location fix is in the future".into());
        }
        if timestamp_ms.saturating_add(30_000) < capture_ms {
            return Err("Location fix is older than 30 seconds; obtain a new fix".into());
        }
        self.datetime()?;
        rational(self.accuracy_m)?;
        if let Some(altitude) = self.altitude_m {
            rational(altitude.abs())?;
        }
        Ok(())
    }

    fn datetime(&self) -> Result<DateTime<Utc>, String> {
        let time = DateTime::from_timestamp_millis(self.timestamp_ms as i64)
            .ok_or("Location timestamp is outside the Exif date range")?;
        if !(1970..=9999).contains(&time.year()) {
            return Err("Location timestamp is outside the Exif date range".into());
        }
        Ok(time)
    }
}

struct Entry {
    tag: u16,
    kind: u16,
    count: u32,
    data: Vec<u8>,
}

impl Entry {
    fn new(tag: u16, kind: u16, count: u32, data: impl Into<Vec<u8>>) -> Self {
        Self {
            tag,
            kind,
            count,
            data: data.into(),
        }
    }
    fn ascii(tag: u16, value: &str) -> Self {
        let mut data = value.as_bytes().to_vec();
        data.push(0);
        Self::new(tag, 2, data.len() as u32, data)
    }
    fn rationals(tag: u16, values: &[(u32, u32)]) -> Self {
        let data: Vec<u8> = values
            .iter()
            .flat_map(|(numerator, denominator)| {
                numerator
                    .to_le_bytes()
                    .into_iter()
                    .chain(denominator.to_le_bytes())
            })
            .collect();
        Self::new(tag, 5, values.len() as u32, data)
    }
}

fn rational(value: f64) -> Result<(u32, u32), String> {
    if !value.is_finite() || !(0.0..=u32::MAX as f64).contains(&value) {
        return Err("Location measurement exceeds the Exif rational range".into());
    }
    // At ordinary device accuracies and altitudes, preserve millimeters. Larger
    // values use the most precise decimal denominator that fits TIFF RATIONAL.
    let mut denominator = 1000u32;
    while (value * denominator as f64).round() > u32::MAX as f64 {
        denominator /= 10;
    }
    Ok(((value * denominator as f64).round() as u32, denominator))
}

fn dms(degrees: f64) -> [(u32, u32); 3] {
    let microseconds = (degrees.abs() * 3_600_000_000.0).round() as u64;
    [
        ((microseconds / 3_600_000_000) as u32, 1),
        (((microseconds / 60_000_000) % 60) as u32, 1),
        ((microseconds % 60_000_000) as u32, 1_000_000),
    ]
}

fn append_ifd(tiff: &mut Vec<u8>, mut entries: Vec<Entry>) {
    entries.sort_by_key(|entry| entry.tag);
    let data_start = tiff.len() + 2 + entries.len() * 12 + 4;
    tiff.extend_from_slice(&(entries.len() as u16).to_le_bytes());
    let mut data = Vec::new();
    for entry in entries {
        tiff.extend_from_slice(&entry.tag.to_le_bytes());
        tiff.extend_from_slice(&entry.kind.to_le_bytes());
        tiff.extend_from_slice(&entry.count.to_le_bytes());
        if entry.data.len() <= 4 {
            let mut inline = [0u8; 4];
            inline[..entry.data.len()].copy_from_slice(&entry.data);
            tiff.extend_from_slice(&inline);
        } else {
            tiff.extend_from_slice(&((data_start + data.len()) as u32).to_le_bytes());
            data.extend_from_slice(&entry.data);
            if data.len() % 2 != 0 {
                data.push(0);
            }
        }
    }
    tiff.extend_from_slice(&0u32.to_le_bytes());
    tiff.extend(data);
}

fn exif_tiff(location: &Location) -> Result<Vec<u8>, String> {
    let time = location.datetime()?;
    let mut gps = vec![
        Entry::new(0, 1, 4, [2, 3, 0, 0]),
        Entry::ascii(1, if location.latitude < 0.0 { "S" } else { "N" }),
        Entry::rationals(2, &dms(location.latitude)),
        Entry::ascii(3, if location.longitude < 0.0 { "W" } else { "E" }),
        Entry::rationals(4, &dms(location.longitude)),
        Entry::rationals(
            7,
            &[
                (time.hour(), 1),
                (time.minute(), 1),
                (time.second() * 1000 + time.timestamp_subsec_millis(), 1000),
            ],
        ),
        Entry::ascii(18, "WGS-84"),
        Entry::ascii(29, &time.format("%Y:%m:%d").to_string()),
        Entry::rationals(31, &[rational(location.accuracy_m)?]),
    ];
    if let Some(altitude) = location.altitude_m {
        // Exif 3.0 corrected refs 0/1 to positive/negative ellipsoidal height.
        // W3C Geolocation reports WGS84 ellipsoidal height, not mean sea level.
        gps.push(Entry::new(5, 1, 1, [u8::from(altitude < 0.0)]));
        gps.push(Entry::rationals(6, &[rational(altitude.abs())?]));
    }
    let mut tiff = b"II\x2a\x00\x08\x00\x00\x00".to_vec();
    // IFD0 has two inline LONG pointers (30 bytes), the Exif IFD one inline
    // version (18 bytes). GPS follows; all offsets are relative to TIFF start.
    append_ifd(
        &mut tiff,
        vec![
            Entry::new(0x8769, 4, 1, 38u32.to_le_bytes()),
            Entry::new(0x8825, 4, 1, 56u32.to_le_bytes()),
        ],
    );
    append_ifd(&mut tiff, vec![Entry::new(0x9000, 7, 4, *b"0310")]);
    append_ifd(&mut tiff, gps);
    Ok(tiff)
}

pub(crate) fn embed(jpeg: &[u8], location: &Location) -> Result<Vec<u8>, String> {
    if !jpeg.starts_with(&[0xff, 0xd8]) {
        return Err("Location metadata requires a JPEG".into());
    }
    let tiff = exif_tiff(location)?;
    let length = u16::try_from(tiff.len() + 8).map_err(|_| "Exif metadata is too large")?;
    let mut output = Vec::with_capacity(jpeg.len() + tiff.len() + 10);
    output.extend_from_slice(&jpeg[..2]);
    output.extend_from_slice(&[0xff, 0xe1]);
    output.extend_from_slice(&length.to_be_bytes());
    output.extend_from_slice(b"Exif\0\0");
    output.extend(tiff);
    output.extend_from_slice(&jpeg[2..]);
    Ok(output)
}

fn same_value(left: &Value, right: &Value) -> bool {
    match (left, right) {
        (Value::Byte(a), Value::Byte(b)) => a == b,
        (Value::Ascii(a), Value::Ascii(b)) => a == b,
        (Value::Undefined(a, _), Value::Undefined(b, _)) => a == b,
        (Value::Rational(a), Value::Rational(b)) => {
            a.len() == b.len()
                && a.iter().zip(b).all(|(a, b)| {
                    a.denom != 0
                        && b.denom != 0
                        && u64::from(a.num) * u64::from(b.denom)
                            == u64::from(b.num) * u64::from(a.denom)
                })
        }
        _ => false,
    }
}

/// Read through an independent TIFF/Exif parser and compare GPS values, not
/// binary offsets. C2PA binding and this semantic consistency check are separate.
pub(crate) fn matches(jpeg: &[u8], location: &Location) -> Result<(), String> {
    let actual = exif::Reader::new()
        .read_from_container(&mut Cursor::new(jpeg))
        .map_err(err)?;
    let expected = exif::Reader::new()
        .read_raw(exif_tiff(location)?)
        .map_err(err)?;
    for field in expected.fields() {
        let matching: Vec<_> = actual
            .fields()
            .filter(|candidate| candidate.tag == field.tag && candidate.ifd_num == In::PRIMARY)
            .collect();
        if matching.len() != 1 || !same_value(&matching[0].value, &field.value) {
            return Err(format!(
                "Exif {} differs from the signed location",
                field.tag
            ));
        }
    }
    if location.altitude_m.is_none()
        && actual
            .fields()
            .any(|field| field.tag == Tag(Context::Gps, 5) || field.tag == Tag(Context::Gps, 6))
    {
        return Err("Exif altitude was not declared in the signed location".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn location() -> Location {
        Location {
            latitude: 47.4979,
            longitude: 19.0402,
            accuracy_m: 12.25,
            altitude_m: Some(-32.75),
            altitude_accuracy_m: Some(5.0),
            timestamp_ms: 1_790_251_202_375.0,
            source: "device-geolocation".into(),
        }
    }

    fn rational_values(exif: &exif::Exif, tag: Tag) -> Vec<f64> {
        match &exif.get_field(tag, In::PRIMARY).unwrap().value {
            Value::Rational(values) => values.iter().map(|value| value.to_f64()).collect(),
            _ => panic!("Expected rational field"),
        }
    }

    #[test]
    fn standard_exif_preserves_coordinates_time_accuracy_and_optional_altitude() {
        for (latitude, longitude, altitude) in [
            (47.4979, 19.0402, Some(-32.75)),
            (-33.8688, -151.2093, Some(0.0)),
            (0.0, 0.0, None),
            (90.0, 180.0, Some(8848.0)),
        ] {
            let mut fix = location();
            fix.latitude = latitude;
            fix.longitude = longitude;
            fix.altitude_m = altitude;
            let bytes = embed(&[0xff, 0xd8, 0xff, 0xd9], &fix).unwrap();
            let exif = exif::Reader::new()
                .read_from_container(&mut Cursor::new(&bytes))
                .unwrap();
            for (tag, reference, coordinate, positive, negative) in [
                (Tag::GPSLatitude, Tag::GPSLatitudeRef, latitude, "N", "S"),
                (Tag::GPSLongitude, Tag::GPSLongitudeRef, longitude, "E", "W"),
            ] {
                let values = rational_values(&exif, tag);
                let degrees = values[0] + values[1] / 60.0 + values[2] / 3600.0;
                assert!((degrees - coordinate.abs()).abs() < 1e-8);
                let expected = if coordinate < 0.0 { negative } else { positive };
                assert!(
                    matches!(&exif.get_field(reference, In::PRIMARY).unwrap().value,
                    Value::Ascii(value) if value == &[expected.as_bytes().to_vec()])
                );
            }
            assert_eq!(
                rational_values(&exif, Tag::GPSHPositioningError),
                vec![12.25]
            );
            assert_eq!(
                rational_values(&exif, Tag::GPSTimeStamp),
                vec![12.0, 0.0, 2.375]
            );
            assert!(
                matches!(&exif.get_field(Tag::GPSDateStamp, In::PRIMARY).unwrap().value,
                Value::Ascii(value) if value == &[b"2026:09:24".to_vec()])
            );
            if let Some(altitude) = altitude {
                assert_eq!(
                    rational_values(&exif, Tag::GPSAltitude),
                    vec![altitude.abs()]
                );
                assert!(
                    matches!(&exif.get_field(Tag::GPSAltitudeRef, In::PRIMARY).unwrap().value,
                    Value::Byte(value) if value == &[u8::from(altitude < 0.0)])
                );
            } else {
                assert!(exif.get_field(Tag::GPSAltitude, In::PRIMARY).is_none());
                assert!(exif.get_field(Tag::GPSAltitudeRef, In::PRIMARY).is_none());
            }
            matches(&bytes, &fix).unwrap();
            let mut different = fix.clone();
            different.latitude -= 0.01;
            assert!(matches(&bytes, &different).is_err());
        }
    }
}
