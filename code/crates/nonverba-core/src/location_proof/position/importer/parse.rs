// SPDX-License-Identifier: AGPL-3.0-only
//! Fixed-width fields follow IGS RINEX 3.05 tables A5/A6 and section 6.8.
use super::super::{
    model::{Ephemeris, Ionosphere},
    orbit::{week_delta, WEEK},
};
use chrono::NaiveDate;
use std::collections::BTreeMap;

pub(super) struct Header {
    pub version: String,
    pub mixed: bool,
    pub ionosphere: Ionosphere,
    pub leap_seconds: Option<u32>,
    pub ignored: BTreeMap<String, usize>,
}
pub(super) enum Record {
    Gps(Box<Ephemeris>),
    Other(char),
}
pub(super) struct Reader<'a> {
    lines: std::str::Lines<'a>,
    line_number: usize,
}
fn field(line: &str, start: usize, width: usize) -> &str {
    line.get(start..line.len().min(start + width)).unwrap_or("")
}
fn number(value: &str) -> Result<f64, String> {
    let text = value.trim();
    if text.is_empty()
        || !text
            .bytes()
            .all(|b| b.is_ascii_digit() || b"+-.eEdD".contains(&b))
    {
        return Err("Missing or malformed finite RINEX numeric field".into());
    }
    let value: f64 = text.replace(['d', 'D'], "E").parse().map_err(crate::err)?;
    if !value.is_finite() {
        return Err("Non-finite RINEX numeric field".into());
    }
    Ok(if value == 0.0 { 0.0 } else { value })
}
fn integer(value: f64, max: u32) -> Result<u32, String> {
    if value < 0.0 || value > f64::from(max) || value.fract() != 0.0 {
        return Err("Invalid RINEX integer-valued field".into());
    }
    Ok(value as u32)
}
fn optional_number(value: &str) -> Result<Option<f64>, String> {
    if value.trim().is_empty() {
        Ok(None)
    } else {
        number(value).map(Some)
    }
}
fn calendar(line: &str) -> Result<i64, String> {
    for separator in [3, 8, 11, 14, 17, 20] {
        if line.as_bytes().get(separator) != Some(&b' ') {
            return Err("Malformed RINEX navigation epoch layout".into());
        }
    }
    let mut parts = Vec::with_capacity(6);
    for (start, width) in [(4, 4), (9, 2), (12, 2), (15, 2), (18, 2), (21, 2)] {
        let part = field(line, start, width);
        if part.len() != width || !part.bytes().all(|b| b.is_ascii_digit()) {
            return Err("Malformed RINEX navigation calendar field".into());
        }
        parts.push(part.parse::<u32>().map_err(crate::err)?);
    }
    let datetime = NaiveDate::from_ymd_opt(parts[0] as i32, parts[1], parts[2])
        .and_then(|date| date.and_hms_opt(parts[3], parts[4], parts[5]))
        .ok_or("Invalid RINEX navigation calendar epoch")?;
    // These are GPST calendar labels for G records, not UTC timestamps. Do not
    // subtract leap seconds here; only the caller's UTC capture window uses them.
    Ok(datetime.and_utc().timestamp() - 315_964_800)
}

impl<'a> Reader<'a> {
    pub fn new(text: &'a str) -> Result<Self, String> {
        if !text.is_ascii() {
            return Err("RINEX input must be plain ASCII text".into());
        }
        Ok(Self {
            lines: text.lines(),
            line_number: 0,
        })
    }
    fn next(&mut self) -> Result<Option<&'a str>, String> {
        let Some(line) = self.lines.next() else {
            return Ok(None);
        };
        self.line_number += 1;
        if line.len() > 80 || line.bytes().any(|b| !(32..=126).contains(&b)) {
            return Err(format!(
                "RINEX line {} exceeds 80 columns or contains controls",
                self.line_number
            ));
        }
        Ok(Some(line))
    }
    fn required(&mut self) -> Result<&'a str, String> {
        self.next()?
            .ok_or_else(|| format!("Truncated RINEX record after line {}", self.line_number))
    }
    pub fn header(&mut self) -> Result<Header, String> {
        let first = self.required()?;
        let version = field(first, 0, 9).trim();
        if !["3.00", "3.01", "3.02", "3.03", "3.04", "3.05"].contains(&version)
            || field(first, 60, 20).trim() != "RINEX VERSION / TYPE"
            || field(first, 20, 1) != "N"
            || !["G", "M"].contains(&field(first, 40, 1))
        {
            return Err("Only RINEX 3.00..3.05 GPS or mixed navigation files are supported".into());
        }
        let mixed = field(first, 40, 1) == "M";
        let version = version.to_owned();
        let mut alpha = None;
        let mut beta = None;
        let mut program = false;
        let mut leap_seconds = None;
        let mut ignored = BTreeMap::new();
        loop {
            if self.line_number >= 1024 {
                return Err("RINEX header exceeds 1024 lines".into());
            }
            let line = self.required()?;
            match field(line, 60, 20).trim() {
                "END OF HEADER" => break,
                "COMMENT" => {}
                "PGM / RUN BY / DATE" if !program => {
                    program = true;
                }
                "IONOSPHERIC CORR" => {
                    let model = field(line, 0, 4).trim();
                    if model == "GPSA" || model == "GPSB" {
                        let mut values = [0.0; 4];
                        for (i, value) in values.iter_mut().enumerate() {
                            *value = number(field(line, 5 + 12 * i, 12))?;
                        }
                        let target = if model == "GPSA" {
                            &mut alpha
                        } else {
                            &mut beta
                        };
                        if target.is_some_and(|existing| existing != values) {
                            return Err("Conflicting GPS ionosphere models require an explicit external selection".into());
                        }
                        *target = Some(values);
                    } else if ["GAL", "BDSA", "BDSB", "QZSA", "QZSB", "IRNA", "IRNB"]
                        .contains(&model)
                    {
                        for i in 0..4 {
                            optional_number(field(line, 5 + 12 * i, 12))?;
                        }
                        super::count(&mut ignored, &format!("ionosphere_{model}"));
                    } else {
                        return Err("Unsupported RINEX ionosphere header model".into());
                    }
                }
                "TIME SYSTEM CORR" => {
                    // Single-GPS processing does not apply inter-system or
                    // fractional GPS-UTC corrections. They are not leap seconds.
                    for (start, width) in [(5, 17), (22, 16), (38, 7), (45, 5)] {
                        number(field(line, start, width))?;
                    }
                    super::count(&mut ignored, "time_system_correction");
                }
                "LEAP SECONDS" => {
                    let system = field(line, 24, 3).trim();
                    let current = integer(number(field(line, 0, 6))?, 128)?;
                    let future = optional_number(field(line, 6, 6))?
                        .map(|v| integer(v, 128))
                        .transpose()?;
                    for (start, max) in [(12, 8191), (18, 7)] {
                        optional_number(field(line, start, 6))?
                            .map(|v| integer(v, max))
                            .transpose()?;
                    }
                    if system == "BDT" {
                        super::count(&mut ignored, "bdt_leap_seconds");
                    } else if system.is_empty() || system == "GPS" {
                        if future.is_some_and(|v| v != 0 && v != current) {
                            return Err("RINEX leap-second transitions require explicit external resolution".into());
                        }
                        if leap_seconds.is_some_and(|v| v != current) {
                            return Err("Conflicting GPS leap-second headers".into());
                        }
                        leap_seconds = Some(current);
                    } else {
                        return Err("Unsupported RINEX leap-second system".into());
                    }
                }
                _ => {
                    return Err(format!(
                        "Unsupported or duplicate RINEX header at line {}",
                        self.line_number
                    ))
                }
            }
        }
        if !program {
            return Err("Missing RINEX PGM / RUN BY / DATE header".into());
        }
        Ok(Header {
            version,
            mixed,
            leap_seconds,
            ignored,
            ionosphere: Ionosphere {
                alpha: alpha.ok_or("GPSA ionosphere coefficients are required")?,
                beta: beta.ok_or("GPSB ionosphere coefficients are required")?,
            },
        })
    }
    pub fn record(&mut self, version: &str, mixed: bool) -> Result<Option<Record>, String> {
        let Some(first) = self.next()? else {
            return Ok(None);
        };
        let system = first
            .chars()
            .next()
            .ok_or("Unexpected blank RINEX record")?;
        let lines = match system {
            'G' | 'E' | 'C' | 'J' | 'I' => 8,
            'R' => {
                if version == "3.05" {
                    5
                } else {
                    4
                }
            }
            'S' => 4,
            _ => return Err("Unsupported RINEX navigation satellite system".into()),
        };
        if !mixed && system != 'G' {
            return Err("Non-GPS record in a GPS-only RINEX file".into());
        }
        let prn = field(first, 1, 2);
        if prn.len() != 2 || !prn.bytes().all(|b| b.is_ascii_digit()) {
            return Err("Malformed RINEX satellite identifier".into());
        }
        let svid = prn.parse::<u16>().map_err(crate::err)?;
        if svid == 0 {
            return Err("Invalid zero RINEX satellite identifier".into());
        }
        let toc_absolute = calendar(first)?;
        let mut clock = [0.0; 3];
        for (i, value) in clock.iter_mut().enumerate() {
            *value = number(field(first, 23 + 19 * i, 19))?;
        }
        let mut rows = [[None; 4]; 7];
        for (row, values) in rows.iter_mut().take(lines - 1).enumerate() {
            let line = self.required()?;
            if field(line, 0, 4) != "    " {
                return Err("Malformed RINEX continuation line".into());
            }
            for (column, value) in values.iter_mut().enumerate() {
                // Reserved GPS fields carry no meaning (RINEX section 6.4).
                if system == 'G' && row == 6 && column >= 2 {
                    continue;
                }
                *value = optional_number(field(line, 4 + 19 * column, 19))?;
            }
        }
        if system != 'G' {
            return Ok(Some(Record::Other(system)));
        }
        let get = |row: usize, col: usize| {
            rows[row][col].ok_or_else(|| "Missing required GPS LNAV field".to_string())
        };
        let week = integer(get(4, 2)?, 8191)?;
        let toe = get(2, 0)?;
        if !(0.0..WEEK).contains(&toe) || toc_absolute < 0 {
            return Err("Invalid GPS TOE or TOC epoch".into());
        }
        let toc = (toc_absolute as f64).rem_euclid(WEEK);
        let toc_delta = toc_absolute as f64 - (f64::from(week) * WEEK + toe);
        if toc_delta.abs() >= WEEK / 2.0 || (toc_delta - week_delta(toc - toe)).abs() > 1e-6 {
            return Err("GPS calendar TOC and expanded TOE week disagree".into());
        }
        let raw_transmission = get(6, 0)?;
        let transmission_tow_s = if (raw_transmission - 999_999_999.999).abs() < 0.001 {
            -1.0 // Explicit unsupported sentinel, never reduced modulo a week.
        } else {
            if (raw_transmission - toe).abs() >= WEEK / 2.0 {
                return Err(
                    "GPS transmission time is not expressed relative to the expanded TOE week"
                        .into(),
                );
            }
            raw_transmission.rem_euclid(WEEK)
        };
        for (column, max) in [(1, 3), (3, 1)] {
            rows[4][column]
                .map(|value| integer(value, max))
                .transpose()?;
        }
        let fit = rows[6][1]
            .map(|v| integer(v, 168))
            .transpose()?
            .unwrap_or(0);
        let ura = get(5, 0)?;
        if !(0.0..=8192.0).contains(&ura) {
            return Err("Invalid RINEX GPS accuracy in metres".into());
        }
        Ok(Some(Record::Gps(Box::new(Ephemeris {
            svid,
            gps_week: week,
            toe_s: toe,
            toc_s: toc,
            transmission_tow_s,
            fit_interval_hours: fit,
            iode: integer(get(0, 0)?, 255)?,
            iodc: integer(get(5, 3)?, 1023)?,
            health: integer(get(5, 1)?, 63)?,
            ura_m: ura,
            sqrt_a_m_sqrt: get(1, 3)?,
            e: get(1, 1)?,
            delta_n_rad_s: get(0, 2)?,
            m0_rad: get(0, 3)?,
            omega_rad: get(3, 2)?,
            omega0_rad: get(2, 2)?,
            omega_dot_rad_s: get(3, 3)?,
            i0_rad: get(3, 0)?,
            idot_rad_s: get(4, 0)?,
            cuc_rad: get(1, 0)?,
            cus_rad: get(1, 2)?,
            crc_m: get(3, 1)?,
            crs_m: get(0, 1)?,
            cic_rad: get(2, 1)?,
            cis_rad: get(2, 3)?,
            af0_s: clock[0],
            af1_s_s: clock[1],
            af2_s_s2: clock[2],
            tgd_s: get(5, 2)?,
        }))))
    }
}
