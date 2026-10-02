// SPDX-License-Identifier: AGPL-3.0-only
//! GPS LNAV equations: IS-GPS-200N 20.3.3.3.3, Table 20-IV.
//! Orbit/clock data is a verifier input; these equations authenticate no RF data.
use super::model::{Ephemeris, Ionosphere, Navigation};
use std::f64::consts::PI;
pub(super) const C: f64 = 299_792_458.0;
pub(super) const WEEK: f64 = 604_800.0;
pub(super) const OMEGA: f64 = 7.292_115_146_7e-5;
const MU: f64 = 3.986_005e14;
const A_WGS84: f64 = 6_378_137.0;
const E2: f64 = 6.694_379_990_141_316_5e-3;

pub(super) fn week_delta(value: f64) -> f64 {
    (value + WEEK / 2.0).rem_euclid(WEEK) - WEEK / 2.0
}
/// Absolute GPS seconds in which the bounded orbit/clock/transmission profile
/// permits this record. TOE owns the expanded week; adjacent TOC/transmission
/// labels are unwrapped around TOE, never around the receiver's claimed week.
pub(super) fn validity_window(e: &Ephemeris) -> (f64, f64) {
    let toe = f64::from(e.gps_week) * WEEK + e.toe_s;
    let toc = toe + week_delta(e.toc_s - e.toe_s);
    let transmission = toe + week_delta(e.transmission_tow_s - e.toe_s);
    (
        (toe - 7200.0).max(toc - 7200.0).max(transmission),
        (toe + 7200.0)
            .min(toc + 7200.0)
            .min(transmission + 14_400.0),
    )
}

pub(super) struct SignalState<'a> {
    pub ephemeris: &'a Ephemeris,
    pub position: [f64; 3],
    pub clock_s: f64,
}

/// Correct each candidate's satellite-clock label before checking its validity
/// and ranking its age. Checking the uncorrected label could admit future/stale
/// data, or incorrectly reject a record exactly at a validity boundary.
pub(super) fn select_signal(
    nav: &Navigation,
    svid: u16,
    week: u32,
    signal_tow: f64,
) -> Result<Option<SignalState<'_>>, String> {
    let mut best: Option<(f64, SignalState<'_>)> = None;
    for e in nav
        .ephemerides
        .iter()
        .filter(|e| e.svid == svid && e.health == 0)
    {
        let mut tx = signal_tow;
        let mut state = satellite(e, tx)?;
        for _ in 0..3 {
            tx = signal_tow - (state.1 - e.tgd_s);
            state = satellite(e, tx)?;
        }
        // Keep subtraction relative to TOE here: converting both endpoints to
        // absolute GPS seconds would lose sub-microsecond boundary precision.
        let dt = (i64::from(week) - i64::from(e.gps_week)) as f64 * WEEK + tx - e.toe_s;
        let clock_age = dt - week_delta(e.toc_s - e.toe_s);
        let since_transmission = dt - week_delta(e.transmission_tow_s - e.toe_s);
        if dt.abs() > 7200.0
            || clock_age.abs() > 7200.0
            || !(0.0..=14_400.0).contains(&since_transmission)
        {
            continue;
        }
        let age = dt.abs();
        if best.as_ref().is_none_or(|(previous_age, previous)| {
            age.total_cmp(previous_age)
                .then_with(|| previous.ephemeris.iode.cmp(&e.iode))
                .is_lt()
        }) {
            best = Some((
                age,
                SignalState {
                    ephemeris: e,
                    position: state.0,
                    clock_s: state.1 - e.tgd_s,
                },
            ));
        }
    }
    Ok(best.map(|(_, state)| state))
}

/// Transmit time is GPS system time relative to the ephemeris GPS week.
/// Return ECEF at transmission and clock polynomial+relativity; TGD separate.
pub(super) fn satellite(e: &Ephemeris, tow: f64) -> Result<([f64; 3], f64), String> {
    let tk = week_delta(tow - e.toe_s);
    let a = e.sqrt_a_m_sqrt * e.sqrt_a_m_sqrt;
    let mean = e.m0_rad + ((MU / (a * a * a)).sqrt() + e.delta_n_rad_s) * tk;
    let mut eccentric = mean;
    let mut converged = false;
    for _ in 0..30 {
        let step = (eccentric - e.e * eccentric.sin() - mean) / (1.0 - e.e * eccentric.cos());
        eccentric -= step;
        if step.abs() < 1e-13 {
            converged = true;
            break;
        }
    }
    if !converged {
        return Err("GPS Kepler iteration did not converge".into());
    }
    let argument =
        ((1.0 - e.e * e.e).sqrt() * eccentric.sin()).atan2(eccentric.cos() - e.e) + e.omega_rad;
    let (sin2, cos2) = (2.0 * argument).sin_cos();
    let u = argument + e.cus_rad * sin2 + e.cuc_rad * cos2;
    let r = a * (1.0 - e.e * eccentric.cos()) + e.crs_m * sin2 + e.crc_m * cos2;
    let i = e.i0_rad + e.idot_rad_s * tk + e.cis_rad * sin2 + e.cic_rad * cos2;
    let omega = e.omega0_rad + (e.omega_dot_rad_s - OMEGA) * tk - OMEGA * e.toe_s;
    let (x, y) = (r * u.cos(), r * u.sin());
    let position = [
        x * omega.cos() - y * i.cos() * omega.sin(),
        x * omega.sin() + y * i.cos() * omega.cos(),
        y * i.sin(),
    ];
    let dt = week_delta(tow - e.toc_s);
    let clock = e.af0_s + e.af1_s_s * dt + e.af2_s_s2 * dt * dt
        - 2.0 * MU.sqrt() * e.e * e.sqrt_a_m_sqrt * eccentric.sin() / (C * C);
    if !position.iter().all(|v| v.is_finite()) || !clock.is_finite() {
        return Err("Invalid propagated GPS state".into());
    }
    Ok((position, clock))
}

pub(super) fn norm(a: [f64; 3]) -> f64 {
    a.iter().map(|v| v * v).sum::<f64>().sqrt()
}
pub(super) fn subtract(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
pub(super) fn lla(r: [f64; 3]) -> [f64; 3] {
    let horizontal = r[0].hypot(r[1]);
    let mut z = r[2];
    let mut n = A_WGS84;
    for _ in 0..20 {
        let sin = z / (horizontal * horizontal + z * z).sqrt();
        n = A_WGS84 / (1.0 - E2 * sin * sin).sqrt();
        let next = r[2] + n * E2 * sin;
        if (next - z).abs() < 1e-5 {
            z = next;
            break;
        }
        z = next;
    }
    [
        z.atan2(horizontal),
        r[1].atan2(r[0]),
        horizontal.hypot(z) - n,
    ]
}
pub(super) fn ecef(llh: [f64; 3]) -> [f64; 3] {
    let (lat, lon, h) = (llh[0], llh[1], llh[2]);
    let n = A_WGS84 / (1.0 - E2 * lat.sin().powi(2)).sqrt();
    [
        (n + h) * lat.cos() * lon.cos(),
        (n + h) * lat.cos() * lon.sin(),
        (n * (1.0 - E2) + h) * lat.sin(),
    ]
}
pub(super) fn azel(llh: [f64; 3], line: [f64; 3]) -> (f64, f64) {
    let (sl, cl) = llh[0].sin_cos();
    let (so, co) = llh[1].sin_cos();
    let east = -so * line[0] + co * line[1];
    let north = -sl * co * line[0] - sl * so * line[1] + cl * line[2];
    let up = cl * co * line[0] + cl * so * line[1] + sl * line[2];
    (
        east.atan2(north).rem_euclid(2.0 * PI),
        up.clamp(-1.0, 1.0).asin(),
    )
}
/// Geometric range includes first-order Earth rotation during signal travel.
pub(super) fn range(s: [f64; 3], r: [f64; 3]) -> (f64, [f64; 3]) {
    let delta = subtract(s, r);
    let distance = norm(delta);
    (
        distance + OMEGA / C * (s[0] * r[1] - s[1] * r[0]),
        delta.map(|v| v / distance),
    )
}

/// Broadcast Klobuchar L1 delay, metres; IS-GPS-200N 20.3.3.5.2.5.
pub(super) fn ionosphere(p: &Ionosphere, tow: f64, llh: [f64; 3], az: f64, el: f64) -> f64 {
    let psi = 0.0137 / (el / PI + 0.11) - 0.022;
    let phi = (llh[0] / PI + psi * az.cos()).clamp(-0.416, 0.416);
    let lam = llh[1] / PI + psi * az.sin() / (phi * PI).cos();
    let geom = phi + 0.064 * ((lam - 1.617) * PI).cos();
    let local = (43_200.0 * lam + tow).rem_euclid(86_400.0);
    let evaluate = |c: [f64; 4]| c[0] + geom * (c[1] + geom * (c[2] + geom * c[3]));
    let amplitude = evaluate(p.alpha).max(0.0);
    let period = evaluate(p.beta).max(72_000.0);
    let phase = 2.0 * PI * (local - 50_400.0) / period;
    let factor = 1.0 + 16.0 * (0.53 - el / PI).powi(3);
    C * factor
        * (5e-9
            + if phase.abs() < 1.57 {
                amplitude * (1.0 - phase * phase / 2.0 + phase.powi(4) / 24.0)
            } else {
                0.0
            })
}
/// Saastamoinen standard atmosphere, fixed relative humidity 0.7. This model is
/// an approximation, not a local pressure/humidity measurement.
pub(super) fn troposphere(llh: [f64; 3], el: f64) -> f64 {
    let h = llh[2].max(0.0);
    let pressure = 1013.25 * (1.0 - 2.2557e-5 * h).powf(5.2568);
    let temperature = 15.0 - 6.5e-3 * h + 273.16;
    let vapor = 6.108 * 0.7 * ((17.15 * temperature - 4684.0) / (temperature - 38.45)).exp();
    (0.0022768 * pressure / (1.0 - 0.00266 * (2.0 * llh[0]).cos() - 0.00028 * h / 1000.0)
        + 0.002277 * (1255.0 / temperature + 0.05) * vapor)
        / el.sin()
}
