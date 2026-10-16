// SPDX-License-Identifier: AGPL-3.0-only
//! Historical verification of an exact exported set against retained inputs.
use std::{env, fs::File, io::Read, path::Path, process::ExitCode, time::{SystemTime, UNIX_EPOCH}};
use futures::executor::block_on;
use nonverba_core::camera_set_evidence::{verify_bundle, CameraSetVerification, MAX_BUNDLE_BYTES, MAX_REQUEST_BYTES};

fn read(path: &Path, limit: usize) -> Result<String, String> {
    let mut bytes=Vec::new();
    File::open(path).map_err(|e|e.to_string())?.take(limit as u64+1).read_to_end(&mut bytes).map_err(|e|e.to_string())?;
    if bytes.len()>limit {return Err("Input exceeds its resource bound".into());}
    String::from_utf8(bytes).map_err(|_|"Inputs must be UTF-8".into())
}
fn run() -> Result<CameraSetVerification, String> {
    let args:Vec<_>=env::args_os().collect();
    if args.len()!=4 {return Err("Usage: verify_camera_set BUNDLE.json ORIGINAL_REQUEST.json EXPECTED_MEDIA_PIN_FILE".into());}
    let bundle=read(Path::new(&args[1]),MAX_BUNDLE_BYTES)?;
    let request=read(Path::new(&args[2]),MAX_REQUEST_BYTES)?;
    let pin=read(Path::new(&args[3]),1024)?;
    let now=SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e|e.to_string())?.as_secs() as f64;
    block_on(verify_bundle(&bundle,&request,pin.trim(),now))
}
fn main() -> ExitCode {
    match run() {
        Ok(report)=>{
            println!("{}",serde_json::to_string_pretty(&report).expect("JSON report"));
            ExitCode::from(if report.verified {0} else {1})
        }
        Err(error)=>{println!("{}",serde_json::json!({"verified":false,"error":error}));ExitCode::from(2)}
    }
}
