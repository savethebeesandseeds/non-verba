// SPDX-License-Identifier: AGPL-3.0-only
//! Experimental, device-dependent acoustic matching; NOT authentication.
//!
//! A nonce-derived 64-symbol FSK marker occupies 768 ms of mono 48 kHz PCM.
//! Both nominal carriers exceed 20 kHz. Finite-duration modulation has spectral
//! sidebands, so this does not promise inaudibility or perfectly band-limited
//! output. A phone can attenuate this band completely; calibration is required.
//!
//! Detection uses phase-independent quadrature energy and searches timing over a
//! bounded recording. It tolerates a gain change and modest noise/delay, but does
//! not establish that a signal travelled through air: software can inject it.
//! The score and thresholds below are experimental, not measured phone accuracy.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const PROFILE: &str = "org.nonverba.audio-fsk.v1";
pub const SAMPLE_RATE: u32 = 48_000;
pub const SYMBOL_COUNT: usize = 64;
pub const SYMBOL_SAMPLES: usize = 576;
pub const PROBE_SAMPLES: usize = SYMBOL_COUNT * SYMBOL_SAMPLES;
pub const MAX_SAMPLES: usize = SAMPLE_RATE as usize * 2;
pub const CARRIER_HZ: [f64; 2] = [20_250.0, 20_750.0];
const AMPLITUDE: f64 = 0.35;
const EDGE_SAMPLES: usize = 48;
const SEARCH_STEP: usize = 24;
const MIN_SCORE: f64 = 0.85;
const MIN_MATCHED_SYMBOLS: u32 = 60;
const MIN_RMS: f64 = 0.0003;
const MIN_BAND_RATIO: f64 = 0.025;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Detection {
    pub detected: bool,
    /// Mean signed FSK contrast mapped to [0,1]; NOT a probability of identity,
    /// freshness, authenticity, or even an independently calibrated confidence.
    pub score: f32,
    pub matched_symbols: u32,
    pub symbol_count: u32,
    /// Best candidate marker start, even when `detected` is false. Timing is an
    /// approximate alignment (allow several milliseconds), not time-of-flight;
    /// playback, recording, filtering and acoustic paths introduce unknown lag.
    pub offset_samples: u32,
    pub sample_rate: u32,
    /// RMS over the best candidate's complete 768 ms interval.
    pub rms: f32,
    /// Fraction of that interval's energy explained by the two nominal carriers.
    pub in_band_ratio: f32,
}

/// Generate the version-1 profile. Session ID and nonce are each exactly 64
/// lowercase hex characters (32 bytes). Index is domain-bound as big-endian u32.
pub fn generate(session_id: &str, index: u32, nonce_hex: &str) -> Result<Vec<f32>, String> {
    let bits = symbols(session_id, index, nonce_hex)?;
    let mut tones = [[0.0_f32; SYMBOL_SAMPLES]; 2];
    for (tone, frequency) in tones.iter_mut().zip(CARRIER_HZ) {
        for (n, sample) in tone.iter_mut().enumerate() {
            let edge = n.min(SYMBOL_SAMPLES - 1 - n);
            let envelope = if edge < EDGE_SAMPLES {
                0.5 - 0.5 * (std::f64::consts::PI * edge as f64 / EDGE_SAMPLES as f64).cos()
            } else {
                1.0
            };
            let phase = std::f64::consts::TAU * frequency * n as f64 / f64::from(SAMPLE_RATE);
            *sample = (AMPLITUDE * envelope * phase.sin()) as f32;
        }
    }
    let mut output = Vec::with_capacity(PROBE_SAMPLES);
    for bit in bits {
        output.extend_from_slice(&tones[usize::from(bit)]);
    }
    Ok(output)
}

/// Match one marker against a 768 ms–2 s recording segment. Input is normalized
/// mono PCM in [-1,1], exactly 48 kHz, with no NaN/infinity. Resampling/downmixing
/// must happen before this call and be recorded by the caller's protocol.
///
/// Four quadrature prefix sums and one energy prefix use <4 MiB at the limit.
/// Precomputation is linear in the input length; each timing trial costs only 64
/// constant-time energy comparisons. No unbounded allocation or FFT is used.
pub fn detect(
    samples: &[f32],
    sample_rate: u32,
    session_id: &str,
    index: u32,
    nonce_hex: &str,
) -> Result<Detection, String> {
    let bits = symbols(session_id, index, nonce_hex)?;
    if sample_rate != SAMPLE_RATE {
        return Err("Audio FSK v1 requires exactly 48000 Hz mono PCM".into());
    }
    if !(PROBE_SAMPLES..=MAX_SAMPLES).contains(&samples.len()) {
        return Err("Audio detector needs a 768 ms to 2 s recording segment".into());
    }
    if samples
        .iter()
        .any(|sample| !sample.is_finite() || sample.abs() > 1.0)
    {
        return Err("Audio PCM samples must be finite values in [-1,1]".into());
    }
    let bands = CARRIER_HZ.map(|frequency| Quadrature::new(samples, frequency));
    let mut energy = Vec::with_capacity(samples.len() + 1);
    energy.push(0.0);
    let mut sum = 0.0;
    for sample in samples {
        sum += f64::from(*sample).powi(2);
        energy.push(sum);
    }
    let mut best = Candidate::default();
    let mut best_offset = 0;
    let last_offset = samples.len() - PROBE_SAMPLES;
    for offset in (0..=last_offset).step_by(SEARCH_STEP) {
        let candidate = measure(&bands, &energy, &bits, offset);
        if candidate.rank() > best.rank() {
            best = candidate;
            best_offset = offset;
        }
    }
    // Include the right boundary and refine the best coarse timing locally.
    // Full-symbol windows retain edge information, unlike only sampling the
    // interior of each constant tone. Still, no sub-sample timing is claimed.
    let boundary = measure(&bands, &energy, &bits, last_offset);
    if boundary.rank() > best.rank() {
        best = boundary;
        best_offset = last_offset;
    }
    let refine_start = best_offset.saturating_sub(SEARCH_STEP - 1);
    let refine_end = (best_offset + SEARCH_STEP - 1).min(last_offset);
    for offset in refine_start..=refine_end {
        let candidate = measure(&bands, &energy, &bits, offset);
        if candidate.rank() > best.rank() {
            best = candidate;
            best_offset = offset;
        }
    }
    let detected = best.score >= MIN_SCORE
        && best.matched >= MIN_MATCHED_SYMBOLS
        && best.rms >= MIN_RMS
        && best.band_ratio >= MIN_BAND_RATIO;
    Ok(Detection {
        detected,
        score: best.score as f32,
        matched_symbols: best.matched,
        symbol_count: SYMBOL_COUNT as u32,
        offset_samples: best_offset as u32,
        sample_rate,
        rms: best.rms as f32,
        in_band_ratio: best.band_ratio as f32,
    })
}

fn hex32(value: &str) -> Result<[u8; 32], String> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err("Audio session ID and nonce must be 64 lowercase hex characters".into());
    }
    fn digit(byte: u8) -> u8 {
        if byte <= b'9' {
            byte - b'0'
        } else {
            byte - b'a' + 10
        }
    }
    let mut decoded = [0; 32];
    for (out, pair) in decoded.iter_mut().zip(value.as_bytes().chunks_exact(2)) {
        *out = (digit(pair[0]) << 4) | digit(pair[1]);
    }
    Ok(decoded)
}

fn symbols(session_id: &str, index: u32, nonce_hex: &str) -> Result<[u8; SYMBOL_COUNT], String> {
    let session = hex32(session_id)?;
    let nonce = hex32(nonce_hex)?;
    let mut digest = Sha256::new();
    digest.update(b"org.nonverba.audio-fsk.v1\0symbols\0");
    digest.update(session);
    digest.update(index.to_be_bytes());
    digest.update(nonce);
    let digest = digest.finalize();
    Ok(std::array::from_fn(|i| (digest[i / 8] >> (7 - i % 8)) & 1))
}

struct Quadrature {
    cosine: Vec<f64>,
    sine: Vec<f64>,
}

impl Quadrature {
    fn new(samples: &[f32], frequency: f64) -> Self {
        let angle = std::f64::consts::TAU * frequency / f64::from(SAMPLE_RATE);
        let (step_sine, step_cosine) = angle.sin_cos();
        let (mut oscillator_sine, mut oscillator_cosine) = (0.0, 1.0);
        let (mut sum_sine, mut sum_cosine) = (0.0, 0.0);
        let mut result = Self {
            cosine: Vec::with_capacity(samples.len() + 1),
            sine: Vec::with_capacity(samples.len() + 1),
        };
        result.cosine.push(0.0);
        result.sine.push(0.0);
        for (i, sample) in samples.iter().enumerate() {
            sum_cosine += f64::from(*sample) * oscillator_cosine;
            sum_sine += f64::from(*sample) * oscillator_sine;
            result.cosine.push(sum_cosine);
            result.sine.push(sum_sine);
            let next_cosine = oscillator_cosine * step_cosine - oscillator_sine * step_sine;
            oscillator_sine = oscillator_sine * step_cosine + oscillator_cosine * step_sine;
            oscillator_cosine = next_cosine;
            if i % 4096 == 4095 {
                let length = oscillator_cosine.hypot(oscillator_sine);
                oscillator_cosine /= length;
                oscillator_sine /= length;
            }
        }
        result
    }

    fn energy(&self, start: usize) -> f64 {
        let end = start + SYMBOL_SAMPLES;
        let cosine = self.cosine[end] - self.cosine[start];
        let sine = self.sine[end] - self.sine[start];
        2.0 * (cosine * cosine + sine * sine) / SYMBOL_SAMPLES as f64
    }
}

#[derive(Default)]
struct Candidate {
    score: f64,
    matched: u32,
    rms: f64,
    band_ratio: f64,
}

impl Candidate {
    fn rank(&self) -> f64 {
        // Contrast finds the right code; a small coherence contribution resolves
        // near-equal alignment peaks without preferring a louder wrong code.
        self.score + self.band_ratio.min(1.0) * 0.01
    }
}

fn measure(
    bands: &[Quadrature; 2],
    energy: &[f64],
    bits: &[u8; SYMBOL_COUNT],
    offset: usize,
) -> Candidate {
    let mut signed_contrast = 0.0;
    let mut band_energy = 0.0;
    let mut matched = 0;
    for (i, bit) in bits.iter().enumerate() {
        let at = offset + i * SYMBOL_SAMPLES;
        let low = bands[0].energy(at);
        let high = bands[1].energy(at);
        let total = low + high;
        band_energy += total;
        if total > 1e-12 {
            let contrast = if *bit == 0 { low - high } else { high - low } / total;
            signed_contrast += contrast;
            if contrast > 0.0 {
                matched += 1;
            }
        }
    }
    let total_energy = (energy[offset + PROBE_SAMPLES] - energy[offset]).max(0.0);
    Candidate {
        score: (0.5 + 0.5 * signed_contrast / SYMBOL_COUNT as f64).clamp(0.0, 1.0),
        matched,
        rms: (total_energy / PROBE_SAMPLES as f64).sqrt(),
        band_ratio: if total_energy > 1e-12 {
            (band_energy / total_energy).clamp(0.0, 1.0)
        } else {
            0.0
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const SESSION: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const NONCE: &str = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

    fn padded(wave: &[f32], offset: usize, gain: f32, noise: f32) -> Vec<f32> {
        let mut samples = vec![0.0; MAX_SAMPLES];
        let mut random = 0x9137_abc1_u32;
        for sample in &mut samples {
            random ^= random << 13;
            random ^= random >> 17;
            random ^= random << 5;
            *sample = noise * (random as f64 / f64::from(u32::MAX) * 2.0 - 1.0) as f32;
        }
        for (target, input) in samples[offset..].iter_mut().zip(wave) {
            *target += gain * input;
            // Same quantization used by the exported PCM16 WAV artifact.
            *target = ((f64::from(*target) * 32767.0).round() / 32767.0) as f32;
        }
        samples
    }

    #[test]
    fn deterministic_profile_has_expected_duration_and_binds_all_inputs() {
        let wave = generate(SESSION, 7, NONCE).unwrap();
        assert_eq!(wave.len(), 36_864);
        assert_eq!(wave, generate(SESSION, 7, NONCE).unwrap());
        assert_ne!(wave, generate(SESSION, 8, NONCE).unwrap());
        assert_ne!(wave, generate(NONCE, 7, NONCE).unwrap());
        assert_ne!(wave, generate(SESSION, 7, SESSION).unwrap());
        assert!(wave.iter().all(|x| x.is_finite() && x.abs() <= 0.350_001));
        assert!(CARRIER_HZ
            .iter()
            .all(|frequency| *frequency > 20_000.0 && *frequency < 24_000.0));
        for symbol in wave.chunks_exact(SYMBOL_SAMPLES) {
            assert_eq!(symbol[0], 0.0);
            assert_eq!(symbol[SYMBOL_SAMPLES - 1], 0.0);
        }
    }

    #[test]
    fn finds_own_wave_and_pcm16_delayed_quiet_noisy_recordings() {
        let wave = generate(SESSION, 7, NONCE).unwrap();
        let direct = detect(&wave, SAMPLE_RATE, SESSION, 7, NONCE).unwrap();
        assert!(direct.detected, "{direct:?}");
        assert_eq!(direct.offset_samples, 0);
        for (offset, gain, noise) in [
            (4_813, 0.8, 0.01),
            (19_217, 0.07, 0.025),
            (59_136, 0.3, 0.005),
        ] {
            let samples = padded(&wave, offset, gain, noise);
            let found = detect(&samples, SAMPLE_RATE, SESSION, 7, NONCE).unwrap();
            assert!(found.detected, "{found:?}");
            assert!(
                found.offset_samples.abs_diff(offset as u32) <= 192,
                "{found:?}, expected {offset}"
            );
            assert!(found.score >= 0.85);
            eprintln!("audio offset={offset}, gain={gain}, noise={noise}: {found:?}");
        }
    }

    #[test]
    fn phase_shift_and_a_mild_acoustic_echo_still_match() {
        let bits = symbols(SESSION, 7, NONCE).unwrap();
        let mut wave = vec![0.0; PROBE_SAMPLES];
        for (i, bit) in bits.iter().enumerate() {
            for n in 0..SYMBOL_SAMPLES {
                // Arbitrary phase per symbol tests energy matching rather than
                // reproducing the generator's exact sine phase.
                let phase = 1.37
                    + i as f64 * 0.29
                    + std::f64::consts::TAU * CARRIER_HZ[usize::from(*bit)] * n as f64
                        / f64::from(SAMPLE_RATE);
                wave[i * SYMBOL_SAMPLES + n] = (0.15 * phase.sin()) as f32;
            }
        }
        let mut samples = padded(&wave, 12_173, 0.8, 0.01);
        for n in (79..samples.len()).rev() {
            samples[n] += samples[n - 79] * 0.2;
        }
        let found = detect(&samples, SAMPLE_RATE, SESSION, 7, NONCE).unwrap();
        assert!(found.detected, "{found:?}");
        assert!(found.offset_samples.abs_diff(12_173) <= 192, "{found:?}");
    }

    #[test]
    fn rejects_wrong_challenge_silence_noise_missing_and_uncoded_tone() {
        let wave = generate(SESSION, 7, NONCE).unwrap();
        let recording = padded(&wave, 7_200, 0.5, 0.005);
        assert!(
            !detect(&recording, SAMPLE_RATE, SESSION, 7, SESSION)
                .unwrap()
                .detected
        );
        assert!(
            !detect(&recording, SAMPLE_RATE, SESSION, 8, NONCE)
                .unwrap()
                .detected
        );
        assert!(
            !detect(&recording, SAMPLE_RATE, NONCE, 7, NONCE)
                .unwrap()
                .detected
        );
        assert!(
            !detect(&vec![0.0; MAX_SAMPLES], SAMPLE_RATE, SESSION, 7, NONCE)
                .unwrap()
                .detected
        );
        assert!(
            !detect(&padded(&[], 0, 1.0, 0.1), SAMPLE_RATE, SESSION, 7, NONCE)
                .unwrap()
                .detected
        );
        let missing = padded(&wave[..PROBE_SAMPLES / 2], 0, 0.8, 0.0);
        assert!(
            !detect(&missing, SAMPLE_RATE, SESSION, 7, NONCE)
                .unwrap()
                .detected
        );
        let continuous: Vec<f32> = (0..MAX_SAMPLES)
            .map(|n| {
                (0.2 * (std::f64::consts::TAU * CARRIER_HZ[0] * n as f64 / f64::from(SAMPLE_RATE))
                    .sin()) as f32
            })
            .collect();
        assert!(
            !detect(&continuous, SAMPLE_RATE, SESSION, 7, NONCE)
                .unwrap()
                .detected
        );
    }

    #[test]
    fn rejects_unsupported_sample_rates_ids_lengths_and_pcm_values() {
        assert!(generate("short", 0, NONCE).is_err());
        assert!(generate(SESSION, 0, &NONCE.to_uppercase()).is_err());
        assert!(generate(SESSION, 0, &"g".repeat(64)).is_err());
        let wave = generate(SESSION, 0, NONCE).unwrap();
        assert!(detect(&wave, 44_100, SESSION, 0, NONCE).is_err());
        assert!(detect(&wave[..PROBE_SAMPLES - 1], SAMPLE_RATE, SESSION, 0, NONCE).is_err());
        assert!(detect(&vec![0.0; MAX_SAMPLES + 1], SAMPLE_RATE, SESSION, 0, NONCE).is_err());
        for value in [f32::NAN, f32::INFINITY, -1.01, 1.01] {
            let mut bad = wave.clone();
            bad[0] = value;
            assert!(detect(&bad, SAMPLE_RATE, SESSION, 0, NONCE).is_err());
        }
    }
}
