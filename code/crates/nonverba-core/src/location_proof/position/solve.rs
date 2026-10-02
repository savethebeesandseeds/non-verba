// SPDX-License-Identifier: AGPL-3.0-only
use super::{linear, model::*, orbit::*};
use crate::location_proof::{RawGnssEpoch, RawGnssTrace, Trace};
use std::{collections::BTreeSet, f64::consts::PI};

struct Observation {
    svid: u16,
    position: [f64; 3],
    clock_s: f64,
    pseudorange: f64,
    sigma: f64,
    iode: u32,
    tow: f64,
}
struct Fit {
    rows: Vec<[f64; 4]>,
    weighted: Vec<[f64; 4]>,
    errors: Vec<f64>,
    satellites: Vec<SatelliteResult>,
}
fn predicted(
    observations: &[Observation],
    x: [f64; 4],
    iono: &Ionosphere,
    atmosphere: bool,
) -> Result<Fit, String> {
    let receiver = [x[0], x[1], x[2]];
    let llh = if atmosphere { lla(receiver) } else { [0.0; 3] };
    if atmosphere && (!llh.iter().all(|v| v.is_finite()) || !(-1000.0..=10_000.0).contains(&llh[2]))
    {
        return Err("GPS position is outside the terrestrial atmosphere profile".into());
    }
    let mut out = Fit {
        rows: Vec::new(),
        weighted: Vec::new(),
        errors: Vec::new(),
        satellites: Vec::new(),
    };
    for o in observations {
        let (geometric, line) = range(o.position, receiver);
        let (az, el) = if atmosphere {
            azel(llh, line)
        } else {
            (0.0, PI / 2.0)
        };
        if !geometric.is_finite() || geometric < 1e6 {
            return Err("GPS satellite range is invalid".into());
        }
        let (ion, trop) = if atmosphere {
            (ionosphere(iono, o.tow, llh, az, el), troposphere(llh, el))
        } else {
            (0.0, 0.0)
        };
        if atmosphere && el < 10.0_f64.to_radians() {
            return Err(
                "GPS solution includes a satellite below the fixed ten-degree elevation mask"
                    .into(),
            );
        }
        let prediction = geometric + x[3] - C * o.clock_s + ion + trop;
        let residual = o.pseudorange - prediction;
        let sigma =
            (o.sigma * o.sigma + (ion * 0.5).powi(2) + (0.3 / (el.sin() + 0.1)).powi(2)).sqrt();
        let row = [-line[0], -line[1], -line[2], 1.0];
        out.rows.push(row);
        out.weighted.push(row.map(|v| v / sigma));
        out.errors.push(residual / sigma);
        out.satellites.push(SatelliteResult {
            svid: o.svid,
            residual_m: residual,
            sigma_m: sigma,
            elevation_deg: el.to_degrees(),
            pseudorange_m: o.pseudorange,
            ephemeris_iode: o.iode,
        });
    }
    Ok(out)
}

fn iterate(
    observations: &[Observation],
    iono: &Ionosphere,
    mut x: [f64; 4],
    atmosphere: bool,
) -> Result<([f64; 4], Fit), String> {
    for _ in 0..20 {
        let fit = predicted(observations, x, iono, atmosphere)?;
        let update = linear::solve(&fit.weighted, &fit.errors)?;
        for i in 0..4 {
            x[i] += update[i];
        }
        if !x.iter().all(|v| v.is_finite())
            || x[..3].iter().any(|v| v.abs() > 1e8)
            || x[3].abs() > C
        {
            return Err("GPS iteration diverged".into());
        }
        if update.iter().all(|v| v.abs() < 1e-4) {
            return Ok((x, predicted(observations, x, iono, atmosphere)?));
        }
    }
    Err("GPS position iteration did not converge".into())
}

pub(super) fn epoch(
    trace: &Trace,
    raw: &RawGnssTrace,
    epoch: &RawGnssEpoch,
    nav: &Navigation,
    policy: &PositionPolicy,
) -> EpochResult {
    let elapsed_ns = epoch
        .clock
        .elapsed_realtime_ns
        .parse::<u64>()
        .ok()
        .and_then(|v| v.checked_sub(raw.anchor_elapsed_realtime_ns.parse().ok()?))
        .unwrap_or(0);
    let elapsed = elapsed_ns / 1_000_000;
    let mut report = EpochResult::empty(epoch.sequence, elapsed);
    report.measurement_elapsed_ns = elapsed_ns;
    let mut run = || -> Result<Vec<Observation>, String> {
        let hardware = epoch.clock.time_ns.parse::<i64>().map_err(crate::err)? as i128;
        let full_bias = epoch
            .clock
            .full_bias_ns
            .parse::<i64>()
            .map_err(crate::err)? as i128;
        let gps = hardware - full_bias;
        if gps < 0 {
            return Err("GPS clock predates its epoch".into());
        }
        let week_ns = 604_800_000_000_000_i128;
        let base_week = gps / week_ns;
        let bias = epoch.clock.bias_ns.unwrap_or(0.0);
        let fractional_tow = (gps % week_ns) as f64 * 1e-9 - bias * 1e-9;
        let week = u32::try_from(base_week + (fractional_tow / WEEK).floor() as i128)
            .map_err(crate::err)?;
        let receiver_tow = fractional_tow.rem_euclid(WEEK);
        let unix_ms = 315_964_800_000_i128 + gps / 1_000_000
            - (bias / 1_000_000.0).round() as i128
            - i128::from(policy.gps_utc_offset_s) * 1000;
        let expected_ms = i128::from(trace.started_at_ms) + i128::from(elapsed);
        let timing_error = "GPS system time disagrees with the signed acquisition epoch";
        if let Some(raw_policy) = trace
            .request
            .policy
            .raw_gnss
            .as_ref()
            .filter(|p| p.max_elapsed_realtime_uncertainty_ns.is_some())
        {
            let uncertainty =
                crate::location_proof::raw_gnss::alignment_uncertainty_ns(&epoch.clock, raw_policy)
                    .ok_or("Invalid reported GPS elapsed-realtime uncertainty")?;
            // Subtract integer origins before dealing with the sub-nanosecond
            // bias fraction. Never cast an absolute GPS epoch to floating point.
            let whole_bias = bias.floor() as i128;
            let fraction = bias - whole_bias as f64;
            let delta_ns = 315_964_800_000_000_000_i128 + gps
                - whole_bias
                - i128::from(policy.gps_utc_offset_s) * 1_000_000_000
                - i128::from(trace.started_at_ms) * 1_000_000
                - i128::from(elapsed_ns);
            let nominal = u64::try_from(delta_ns.unsigned_abs()).map_err(|_| timing_error)?;
            let nominal = nominal
                .checked_add(u64::from(delta_ns <= 0 && fraction > 0.0))
                .ok_or(timing_error)?;
            let timing = TimingBudget::new(
                nominal,
                epoch.clock.elapsed_realtime_uncertainty_ns,
                uncertainty,
            );
            report.clock_alignment = Some(timing);
            if timing.budgeted_interval_ns > 1_000_000_000 {
                return Err(timing_error.into());
            }
        } else if (unix_ms - expected_ms).abs() > 1000 {
            return Err(timing_error.into());
        }
        let mut seen = BTreeSet::new();
        let mut observations = Vec::new();
        for m in &epoch.measurements {
            let reject = if m.constellation != 1 {
                Some("not GPS")
            } else if m.code_type.as_deref() != Some("C")
                || m.carrier_frequency_hz
                    .is_none_or(|f| (f - 1_575_420_000.0).abs() > 100_000.0)
            {
                Some("not identified GPS L1 C/A")
            } else if m.state & 1 == 0 || m.state & (8 | 16384) == 0 || m.state & 16 != 0 {
                Some("ambiguous GPS code time")
            } else if m.time_offset_ns.abs() > 1_000_000.0 {
                Some("measurement outside one-millisecond epoch")
            } else if m.cn0_dbhz < 18.0 {
                Some("C/N0 below fixed L1 threshold")
            } else if m
                .received_sv_time_uncertainty_ns
                .parse::<f64>()
                .unwrap_or(f64::INFINITY)
                > policy.max_sv_time_uncertainty_ns
            {
                Some("excessive code-time uncertainty")
            } else {
                None
            };
            if let Some(reason) = reject {
                report
                    .excluded
                    .push(format!("{}:{}: {reason}", m.constellation, m.svid));
                continue;
            }
            if !seen.insert(m.svid) {
                return Err("Duplicate GPS L1 C/A satellite observation".into());
            }
            let measurement_tow = receiver_tow + m.time_offset_ns * 1e-9;
            let satellite_tow =
                m.received_sv_time_ns.parse::<u64>().map_err(crate::err)? as f64 * 1e-9;
            let transit = week_delta(measurement_tow - satellite_tow);
            let pseudorange = transit * C;
            if !(10_000_000.0..=50_000_000.0).contains(&pseudorange) {
                return Err("GPS pseudorange is outside the bounded L1 profile".into());
            }
            let tx_signal = measurement_tow - transit;
            let Some(state) = select_signal(nav, m.svid, week, tx_signal)? else {
                report
                    .excluded
                    .push(format!("1:{}: no healthy current ephemeris", m.svid));
                continue;
            };
            let eph = state.ephemeris;
            let sigma = (25.0
                + (C * m
                    .received_sv_time_uncertainty_ns
                    .parse::<f64>()
                    .map_err(crate::err)?
                    * 1e-9)
                    .powi(2)
                + eph.ura_m.powi(2))
            .sqrt();
            observations.push(Observation {
                svid: m.svid,
                position: state.position,
                clock_s: state.clock_s,
                pseudorange,
                sigma,
                iode: eph.iode,
                tow: measurement_tow,
            });
        }
        if observations.len() < policy.min_satellites {
            return Err(format!(
                "Only {} usable GPS L1 C/A satellites; {} required",
                observations.len(),
                policy.min_satellites
            ));
        }
        Ok(observations)
    };
    let mut observations = match run() {
        Ok(v) => v,
        Err(e) => {
            report.errors.push(e);
            return report;
        }
    };
    let mut solution = || -> Result<([f64; 4], Fit, f64), String> {
        // The operator's claimed latitude/longitude is never an initializer.
        let (initial, _) = iterate(&observations, &nav.ionosphere, [0.0; 4], false)?;
        let receiver = [initial[0], initial[1], initial[2]];
        let llh = lla(receiver);
        observations.retain(|o| {
            let (_, line) = range(o.position, receiver);
            let elevation = azel(llh, line).1;
            if elevation < 10.0_f64.to_radians() {
                report.excluded.push(format!(
                    "1:{}: below fixed ten-degree elevation mask",
                    o.svid
                ));
                false
            } else {
                true
            }
        });
        if observations.len() < policy.min_satellites {
            return Err("Insufficient GPS satellites above the elevation mask".into());
        }
        let (x, fit) = iterate(&observations, &nav.ionosphere, initial, true)?;
        let dop = linear::pdop(&fit.rows)?;
        Ok((x, fit, dop))
    };
    match solution() {
        Err(e) => report.errors.push(e),
        Ok((x, fit, dop)) => {
            let position = [x[0], x[1], x[2]];
            let llh = lla(position);
            report.computed = true;
            report.ecef_m = Some(position);
            report.latitude_deg = Some(llh[0].to_degrees());
            report.longitude_deg = Some(llh[1].to_degrees());
            report.ellipsoid_height_m = Some(llh[2]);
            report.receiver_clock_bias_m = Some(x[3]);
            report.pdop = Some(dop);
            let rms = (fit.errors.iter().map(|v| v * v).sum::<f64>()
                / (fit.errors.len() - 4) as f64)
                .sqrt();
            report.weighted_rms = Some(rms);
            report.satellites = fit.satellites;
            if dop > policy.max_pdop {
                report
                    .errors
                    .push("GPS geometry exceeds the PDOP limit".into());
            }
            if rms > policy.max_weighted_rms {
                report
                    .errors
                    .push("GPS normalized residual exceeds the policy".into());
            }
            if report
                .satellites
                .iter()
                .any(|s| s.residual_m.abs() > policy.max_residual_m)
            {
                report
                    .errors
                    .push("GPS code residual exceeds the policy".into());
            }
            report.consistency_passed = report.errors.is_empty();
        }
    }
    report
}
