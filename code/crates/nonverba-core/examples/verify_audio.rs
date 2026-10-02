// SPDX-License-Identifier: AGPL-3.0-only
//! Verify a WAV against the requester's independently retained request, transcript,
//! and operator pin. Uses the current clock; does not accept or consume a request.

use std::{
    env,
    ffi::OsStr,
    fs::File,
    io::Read,
    path::Path,
    process::ExitCode,
    time::{SystemTime, UNIX_EPOCH},
};

use futures::executor::block_on;
use nonverba_core::{audio::AudioVerification, verify_audio};
use serde::Deserialize;

fn read_bounded(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    File::open(path)
        .map_err(|error| format!("Cannot open {}: {error}", path.display()))?
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Cannot read {}: {error}", path.display()))?;
    if bytes.len() as u64 > limit {
        return Err(format!("{} exceeds the input size limit", path.display()));
    }
    Ok(bytes)
}

fn read_json(path: &OsStr) -> Result<String, String> {
    String::from_utf8(read_bounded(Path::new(path), 64 * 1024)?)
        .map_err(|_| "JSON input must be UTF-8".into())
}

fn pin_argument(value: &OsStr) -> Result<String, String> {
    let is_pin = |pin: &str| pin.len() == 64 && pin.bytes().all(|byte| byte.is_ascii_hexdigit());
    let direct = value.to_str().unwrap_or_default();
    if is_pin(direct) {
        return Ok(direct.to_ascii_lowercase());
    }
    let text = read_json(value)?;
    // The audio app exports a public JSON ID; also accept the plain text ID
    // exported by the camera, or a literal fingerprint on the command line.
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct PublicId {
        fingerprint: String,
    }
    let fingerprint = if text.trim_start().starts_with('{') {
        serde_json::from_str::<PublicId>(&text)
            .map_err(|_| "Public device ID JSON must contain only a fingerprint")?
            .fingerprint
    } else {
        text.lines().next().unwrap_or_default().trim().to_owned()
    };
    if !is_pin(&fingerprint) {
        return Err(
            "Device ID must contain a 64-character hexadecimal certificate fingerprint".into(),
        );
    }
    Ok(fingerprint.to_ascii_lowercase())
}

fn run() -> Result<AudioVerification, String> {
    let args: Vec<_> = env::args_os().collect();
    if args.len() != 5 {
        return Err("Usage: verify_audio AUDIO.wav REQUEST.json TRANSCRIPT.json DEVICE_FINGERPRINT_OR_PUBLIC_ID_FILE".into());
    }
    let wav = read_bounded(Path::new(&args[1]), 8 * 1024 * 1024)?;
    let request = read_json(&args[2])?;
    let transcript = read_json(&args[3])?;
    let fingerprint = pin_argument(&args[4])?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "System clock precedes the Unix epoch")?
        .as_secs() as f64;
    let report = block_on(verify_audio(&wav, &request, &transcript, &fingerprint, now))?;
    serde_json::from_str(&report).map_err(|error| error.to_string())
}

fn main() -> ExitCode {
    match run() {
        Ok(report) => {
            println!(
                "{}",
                serde_json::to_string_pretty(&report).expect("JSON report serialization")
            );
            ExitCode::from(if report.verified { 0 } else { 1 })
        }
        Err(error) => {
            println!("{}", serde_json::json!({"verified":false,"error":error}));
            ExitCode::from(2)
        }
    }
}
