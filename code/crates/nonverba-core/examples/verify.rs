// SPDX-License-Identifier: AGPL-3.0-only
//! Verify an exported JPEG using the requester's saved challenge and device pin.
//! This is historical verification; it does not consume a one-time request.

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
use nonverba_core::{verify_image, Verification};

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

fn pin_argument(value: &OsStr) -> Result<String, String> {
    let direct = value.to_str().unwrap_or_default();
    let is_pin = |pin: &str| pin.len() == 64 && pin.bytes().all(|byte| byte.is_ascii_hexdigit());
    if is_pin(direct) {
        return Ok(direct.to_ascii_lowercase());
    }
    let text = String::from_utf8(read_bounded(Path::new(value), 64 * 1024)?)
        .map_err(|_| "Device pin file must be UTF-8")?;
    let pin = text.lines().next().unwrap_or_default().trim();
    if !is_pin(pin) {
        return Err("Device pin must be 64 hexadecimal characters or a file whose first line contains that pin".into());
    }
    Ok(pin.to_ascii_lowercase())
}

fn run() -> Result<Verification, String> {
    let args: Vec<_> = env::args_os().collect();
    if args.len() != 4 {
        return Err("Usage: verify IMAGE.jpg CHALLENGE.json DEVICE_FINGERPRINT_OR_FILE".into());
    }
    let image = read_bounded(Path::new(&args[1]), 32 * 1024 * 1024)?;
    let challenge = String::from_utf8(read_bounded(Path::new(&args[2]), 64 * 1024)?)
        .map_err(|_| "Challenge file must be UTF-8")?;
    let pin = pin_argument(&args[3])?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "System clock precedes the Unix epoch")?
        .as_secs() as f64;
    let json = block_on(verify_image(&image, &challenge, &pin, now))?;
    serde_json::from_str(&json).map_err(|error| error.to_string())
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
            println!("{}", serde_json::json!({"verified": false, "error": error}));
            ExitCode::from(2)
        }
    }
}
