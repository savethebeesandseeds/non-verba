// SPDX-License-Identifier: AGPL-3.0-only
//! Importer tests; fixtures are navigation data, never physical sensor evidence.
use super::*;
use chrono::NaiveDate;
use serde_json::Value;

const EXCERPT: &str = include_str!("igs-2026270-excerpt.rnx");
const EXCERPT_SHA256: &str = "626044960321d5730074f257283b208a8ce8248f138d8084cf32d87d569344e8";
fn start() -> f64 {
    NaiveDate::from_ymd_opt(2026, 9, 27)
        .unwrap()
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_utc()
        .timestamp() as f64
}
fn import(text: &str) -> Result<Value, String> {
    let out = import_gps_lnav_rinex(
        text,
        "IGS/BKG test excerpt",
        &hash(text.as_bytes()),
        start(),
        start() + 30.0,
        18,
    )?;
    serde_json::from_str(&out).map_err(crate::err)
}
fn lines(text: &str) -> Vec<String> {
    text.lines().map(str::to_owned).collect()
}
fn text(lines: &[String]) -> String {
    lines.join("\n") + "\n"
}
fn gps_index(lines: &[String]) -> usize {
    lines.iter().position(|v| v.starts_with("G01 ")).unwrap()
}
fn header(text: &str) -> Vec<String> {
    let lines = lines(text);
    let end = lines
        .iter()
        .position(|v| v.contains("END OF HEADER"))
        .unwrap();
    lines[..=end].to_vec()
}
fn replace_field(line: &mut String, start: usize, width: usize, value: &str) {
    assert!(value.len() <= width);
    while line.len() < start + width {
        line.push(' ');
    }
    line.replace_range(start..start + width, &format!("{value:>width$}"));
}

#[test]
fn imports_real_igs_fields_without_semicircle_ura_index_or_week_reinterpretation() {
    assert_eq!(hash(EXCERPT.as_bytes()), EXCERPT_SHA256);
    let imported = import(EXCERPT).unwrap();
    let nav: Navigation =
        serde_json::from_str(imported["navigation_json"].as_str().unwrap()).unwrap();
    validate_nav(&nav).unwrap();
    assert_eq!(nav.source.sha256, EXCERPT_SHA256);
    assert_eq!(
        imported["navigation_sha256"],
        hash(imported["navigation_json"].as_str().unwrap().as_bytes())
    );
    let gps1 = nav.ephemerides.iter().find(|e| e.svid == 1).unwrap();
    assert_eq!(gps1.gps_week, 2438);
    assert_eq!(gps1.toe_s, 0.0);
    assert_eq!(gps1.toc_s, 0.0);
    assert_eq!(gps1.transmission_tow_s, 604_728.0);
    assert_eq!(gps1.ura_m, 2.0);
    assert_eq!(gps1.iode, 147);
    assert_eq!(gps1.iodc, 659);
    assert_eq!(gps1.af0_s, 1.630480401220e-4);
    assert_eq!(gps1.omega0_rad, -6.223027590760e-1);
    assert_eq!(
        nav.ionosphere.alpha,
        [1.3039e-8, 1.4901e-8, -5.9605e-8, -1.1921e-7]
    );
    let report = &imported["import_report"];
    assert_eq!(report["gps_records_read"], 32);
    assert_eq!(report["records_read"], 38);
    for system in ['C', 'E', 'I', 'J', 'R', 'S'] {
        assert_eq!(report["skipped_records"][format!("non_gps_{system}")], 1);
    }
    assert_eq!(report["navigation_source_authenticated"], false);
    assert_eq!(report["satellite_authentication_verified"], false);
}

#[test]
fn digest_is_of_exact_input_bytes_including_line_endings() {
    let crlf = EXCERPT.replace('\n', "\r\n");
    assert!(
        import_gps_lnav_rinex(&crlf, "source", EXCERPT_SHA256, start(), start(), 18)
            .unwrap_err()
            .contains("digest")
    );
    let imported = import(&crlf).unwrap();
    assert_eq!(
        imported["import_report"]["source_sha256"],
        hash(crlf.as_bytes())
    );
    assert!(
        import_gps_lnav_rinex(EXCERPT, "source", EXCERPT_SHA256, start(), start(), 17)
            .unwrap_err()
            .contains("offset")
    );
}

#[test]
fn identical_records_deduplicate_but_conflicting_epoch_or_ionosphere_fails() {
    let mut rows = lines(EXCERPT);
    let index = gps_index(&rows);
    let duplicate = rows[index..index + 8].to_vec();
    rows.extend(duplicate);
    let imported = import(&text(&rows)).unwrap();
    assert_eq!(
        imported["import_report"]["skipped_records"]["identical_duplicate"],
        1
    );
    let duplicate_index = rows.len() - 8;
    replace_field(&mut rows[duplicate_index], 23, 19, "1.730480401220E-04");
    assert!(import(&text(&rows))
        .unwrap_err()
        .contains("Conflicting RINEX"));
    let mut rows = lines(EXCERPT);
    let index = rows.iter().position(|v| v.starts_with("GPSA")).unwrap();
    let mut conflict = rows[index].clone();
    replace_field(&mut conflict, 5, 12, "2.3039E-08");
    rows.insert(index + 1, conflict);
    assert!(import(&text(&rows)).unwrap_err().contains("ionosphere"));
}

#[test]
fn unsupported_status_is_reported_without_inventing_defaults() {
    for (row, column, value, reason) in [
        (7, 1, "", "unsupported_or_unknown_fit_interval"),
        (7, 1, "6.0E+00", "unsupported_or_unknown_fit_interval"),
        (7, 0, ".999999999999E+09", "unknown_transmission_time"),
        (6, 0, "8192.0", "unsupported_accuracy"),
        (6, 1, "1.0", "unhealthy"),
    ] {
        let mut rows = lines(EXCERPT);
        let index = gps_index(&rows);
        replace_field(&mut rows[index + row], 4 + 19 * column, 19, value);
        let imported = import(&text(&rows)).unwrap();
        assert!(
            imported["import_report"]["skipped_records"][reason]
                .as_u64()
                .unwrap()
                >= 1
        );
        let nav: Navigation =
            serde_json::from_str(imported["navigation_json"].as_str().unwrap()).unwrap();
        assert!(!nav.ephemerides.iter().any(|e| e.svid == 1));
    }
}

#[test]
fn malformed_required_fields_are_rejected_even_outside_capture_window() {
    for (row, column, value) in [
        (1, 0, "147.5"),
        (2, 3, ""),
        (2, 1, "NaN"),
        (5, 2, "1414"),
        (7, 0, "604728"),
    ] {
        let mut rows = lines(EXCERPT);
        let index = gps_index(&rows);
        replace_field(&mut rows[index + row], 4 + 19 * column, 19, value);
        assert!(
            import(&text(&rows)).is_err(),
            "row={row}, col={column}, value={value}"
        );
    }
    let mut rows = lines(EXCERPT);
    let index = gps_index(&rows);
    replace_field(&mut rows[index], 12, 2, "32");
    assert!(import(&text(&rows)).unwrap_err().contains("calendar"));
    let mut rows = lines(EXCERPT);
    rows.pop();
    assert!(import(&text(&rows)).unwrap_err().contains("Truncated"));
}

#[test]
fn version_header_frame_and_bounds_fail_closed() {
    for version in ["2.11", "4.02", "3.06"] {
        let mut rows = lines(EXCERPT);
        replace_field(&mut rows[0], 0, 9, version);
        assert!(import(&text(&rows)).unwrap_err().contains("Only RINEX"));
    }
    for bad in [
        EXCERPT.replacen("IONOSPHERIC CORR", "UNKNOWN HEADER ", 1),
        EXCERPT.replacen("G01 ", "X01 ", 1),
        EXCERPT.replacen("G01 ", "G00 ", 1),
        EXCERPT.replacen("G01 ", "G1  ", 1),
    ] {
        assert!(import(&bad).is_err());
    }
    for (begin, end) in [
        (f64::NAN, start()),
        (start(), start() - 1.0),
        (start(), start() + 3600.001),
    ] {
        assert!(import_gps_lnav_rinex(EXCERPT, "source", EXCERPT_SHA256, begin, end, 18).is_err());
    }
    assert!(import(&" ".repeat(MAX_RINEX_BYTES + 1)).is_err());
    assert!(import_gps_lnav_rinex(
        EXCERPT,
        "source",
        EXCERPT_SHA256,
        start() + 86_400.0,
        start() + 86_400.0,
        18
    )
    .is_err());
}

#[test]
fn capture_subset_cannot_silently_truncate_to_128() {
    let rows = lines(EXCERPT);
    let index = gps_index(&rows);
    let mut selected = header(EXCERPT);
    for toe in 0..129 {
        let mut record = rows[index..index + 8].to_vec();
        replace_field(&mut record[3], 4, 19, &toe.to_string());
        selected.extend(record);
    }
    assert!(import(&text(&selected)).unwrap_err().contains("128"));
    selected.truncate(selected.len() - 8);
    let out = import(&text(&selected)).unwrap();
    assert_eq!(out["import_report"]["selected_ephemerides"], 128);
}

#[test]
fn d_and_lowercase_exponents_and_glonass_305_frame_are_supported() {
    let mut rows = lines(EXCERPT);
    replace_field(&mut rows[0], 0, 9, "3.05");
    let r = rows
        .iter()
        .position(|v| v.starts_with('R') && v.as_bytes()[1].is_ascii_digit())
        .unwrap();
    // 3.05 adds a fourth GLONASS continuation line; only its structure is read.
    rows.insert(
        r + 4,
        "     0.000000000000E+00 0.000000000000E+00 0.000000000000E+00 0.000000000000E+00".into(),
    );
    let value = text(&rows).replace("E+", "d+").replace("E-", "D-");
    let out = import(&value).unwrap();
    assert_eq!(out["import_report"]["skipped_records"]["non_gps_R"], 1);
}

#[test]
#[ignore = "Requires separately retained public IGS archive; set NONVERBA_RINEX_FILE and NONVERBA_RINEX_SHA256"]
fn complete_external_daily_archive() {
    let path = std::env::var("NONVERBA_RINEX_FILE").unwrap();
    let expected = std::env::var("NONVERBA_RINEX_SHA256").unwrap();
    let text = std::fs::read_to_string(path).unwrap();
    let out = import_gps_lnav_rinex(
        &text,
        "https://igs.bkg.bund.de/root_ftp/IGS/BRDC/2026/270/BRDC00IGS_R_20262700000_01D_MN.rnx.gz",
        &expected,
        start(),
        start() + 30.0,
        18,
    )
    .unwrap();
    let parsed: Value = serde_json::from_str(&out).unwrap();
    println!("{}", parsed["import_report"]);
    assert_eq!(parsed["import_report"]["records_read"], 23_618);
    assert_eq!(parsed["import_report"]["gps_records_read"], 449);
    assert!(
        parsed["import_report"]["selected_ephemerides"]
            .as_u64()
            .unwrap()
            >= 6
    );
}
