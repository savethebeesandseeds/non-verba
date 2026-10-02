// SPDX-License-Identifier: AGPL-3.0-only
//! Bounded offline RINEX 3 GPS-LNAV normalization for independently pinned input.
//! Import is not authentication of the provider, satellite, or physical location.
mod parse;
use super::{canonical_hash, hash, model::*, orbit, validate_nav};
use serde::Serialize;
use std::collections::BTreeMap;
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

pub const MAX_RINEX_BYTES: usize = 16 * 1024 * 1024;
const MAX_RECORDS: usize = 32_768;
const GPS_EPOCH_UNIX: f64 = 315_964_800.0;

#[derive(Serialize)]
struct ImportReport {
    version: u32,
    method: &'static str,
    rinex_version: String,
    source_bytes: usize,
    source_sha256: String,
    window_start_unix_secs: f64,
    window_end_unix_secs: f64,
    gps_utc_offset_s: u32,
    window_padding_s: u32,
    records_read: usize,
    gps_records_read: usize,
    selected_ephemerides: usize,
    skipped_records: BTreeMap<String, usize>,
    ignored_header_records: BTreeMap<String, usize>,
    header_gps_utc_offset_s: Option<u32>,
    navigation_source_authenticated: bool,
    satellite_authentication_verified: bool,
}
#[derive(Serialize)]
struct Imported {
    navigation_json: String,
    navigation_sha256: String,
    import_report: ImportReport,
}
fn count(counts: &mut BTreeMap<String, usize>, reason: &str) {
    *counts.entry(reason.into()).or_default() += 1;
}

/// Caller supplies the exact source-file digest and capture window independently
/// from operator evidence. Text is hashed before CRLF/field parsing. Gzip,
/// RINEX 2/4, almanacs and satellite authentication are outside this importer.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn import_gps_lnav_rinex(
    rinex_text: &str,
    source_id: &str,
    expected_source_sha256: &str,
    window_start_unix_secs: f64,
    window_end_unix_secs: f64,
    gps_utc_offset_s: u32,
) -> Result<String, String> {
    if rinex_text.is_empty() || rinex_text.len() > MAX_RINEX_BYTES {
        return Err("RINEX input must contain 1..16777216 uncompressed bytes".into());
    }
    if source_id.trim().is_empty()
        || source_id.len() > 512
        || source_id.chars().any(char::is_control)
        || !canonical_hash(expected_source_sha256)
    {
        return Err("Invalid independent RINEX source label or SHA-256 pin".into());
    }
    if !window_start_unix_secs.is_finite()
        || !window_end_unix_secs.is_finite()
        || window_start_unix_secs < GPS_EPOCH_UNIX + orbit::WEEK
        || window_end_unix_secs >= GPS_EPOCH_UNIX + 8192.0 * orbit::WEEK - 128.0
        || window_end_unix_secs < window_start_unix_secs
        || window_end_unix_secs - window_start_unix_secs > 3600.0
        || gps_utc_offset_s > 128
    {
        return Err(
            "Invalid independent RINEX capture window (maximum one hour) or GPS-UTC offset".into(),
        );
    }
    let digest = hash(rinex_text.as_bytes());
    if digest != expected_source_sha256 {
        return Err("RINEX bytes differ from the independently retained source digest".into());
    }
    let mut reader = parse::Reader::new(rinex_text)?;
    let header = reader.header()?;
    if header.leap_seconds.is_some_and(|v| v != gps_utc_offset_s) {
        return Err("RINEX GPS leap seconds disagree with the independent GPS-UTC offset".into());
    }
    let mut nav = Navigation {
        version: 1,
        kind: "nonverba-gps-lnav".into(),
        source: Source {
            id: source_id.into(),
            sha256: digest.clone(),
        },
        ionosphere: header.ionosphere,
        ephemerides: Vec::new(),
    };
    let mut report = ImportReport {
        version: 1,
        method: "rinex3-gps-lnav-import-v1",
        rinex_version: header.version.clone(),
        source_bytes: rinex_text.len(),
        source_sha256: digest,
        window_start_unix_secs,
        window_end_unix_secs,
        gps_utc_offset_s,
        window_padding_s: 2,
        records_read: 0,
        gps_records_read: 0,
        selected_ephemerides: 0,
        skipped_records: BTreeMap::new(),
        ignored_header_records: header.ignored,
        header_gps_utc_offset_s: header.leap_seconds,
        navigation_source_authenticated: false,
        satellite_authentication_verified: false,
    };
    // Cover the solver's bounded receiver-clock displacement, code travel time,
    // signal-clock correction and epoch rounding around the acquisition window.
    let start = window_start_unix_secs - GPS_EPOCH_UNIX + f64::from(gps_utc_offset_s) - 2.0;
    let end = window_end_unix_secs - GPS_EPOCH_UNIX + f64::from(gps_utc_offset_s) + 2.0;
    let mut checked_nav = nav.clone();
    while let Some(record) = reader.record(&header.version, header.mixed)? {
        report.records_read += 1;
        if report.records_read > MAX_RECORDS {
            return Err("RINEX input exceeds 32768 navigation records".into());
        }
        let parse::Record::Gps(e) = record else {
            let parse::Record::Other(system) = record else {
                unreachable!()
            };
            count(&mut report.skipped_records, &format!("non_gps_{system}"));
            continue;
        };
        let e = *e;
        report.gps_records_read += 1;
        // Check all required orbit/clock values even on unselected records. The
        // three explicitly unsupported status values below are not defaults.
        let mut checked = e.clone();
        checked.fit_interval_hours = 4;
        checked.ura_m = 0.0;
        checked.transmission_tow_s = 0.0;
        checked_nav.ephemerides.clear();
        checked_nav.ephemerides.push(checked);
        validate_nav(&checked_nav)?;
        let unsupported = if e.health != 0 {
            Some("unhealthy")
        } else if e.fit_interval_hours != 4 {
            Some("unsupported_or_unknown_fit_interval")
        } else if e.ura_m > 100.0 {
            Some("unsupported_accuracy")
        } else if e.transmission_tow_s < 0.0 {
            Some("unknown_transmission_time")
        } else {
            None
        };
        if let Some(reason) = unsupported {
            count(&mut report.skipped_records, reason);
            continue;
        }
        let (valid_start, valid_end) = orbit::validity_window(&e);
        if valid_start > valid_end || valid_start > end || valid_end < start {
            count(&mut report.skipped_records, "outside_capture_window");
            continue;
        }
        if let Some(existing) = nav
            .ephemerides
            .iter()
            .find(|v| v.svid == e.svid && v.gps_week == e.gps_week && v.toe_s == e.toe_s)
        {
            if serde_json::to_string(existing).map_err(crate::err)?
                != serde_json::to_string(&e).map_err(crate::err)?
            {
                return Err(
                    "Conflicting RINEX GPS records share satellite, expanded week and TOE".into(),
                );
            }
            count(&mut report.skipped_records, "identical_duplicate");
            continue;
        }
        nav.ephemerides.push(e);
        if nav.ephemerides.len() > MAX_EPHEMERIDES {
            return Err("Capture window selects more than 128 GPS ephemerides; retain a narrower independent window".into());
        }
    }
    nav.ephemerides.sort_by(|a, b| {
        a.svid
            .cmp(&b.svid)
            .then(a.gps_week.cmp(&b.gps_week))
            .then(a.toe_s.total_cmp(&b.toe_s))
    });
    validate_nav(&nav)?;
    report.selected_ephemerides = nav.ephemerides.len();
    let navigation_json = serde_json::to_string(&nav).map_err(crate::err)?;
    if navigation_json.len() > MAX_NAV_BYTES {
        return Err("Imported navigation JSON exceeds the verifier's byte bound".into());
    }
    serde_json::to_string(&Imported {
        navigation_sha256: hash(navigation_json.as_bytes()),
        navigation_json,
        import_report: report,
    })
    .map_err(crate::err)
}

#[cfg(test)]
mod tests;
