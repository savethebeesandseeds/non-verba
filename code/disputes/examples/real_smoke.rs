// SPDX-License-Identifier: AGPL-3.0-only
//! Explicit local CPU plumbing probe. No downloads, container changes, or retries.
//! Administrative resource files are inputs; historical captures are never changed.
use nonverba_requests::encoding::{bytes_digest, strict_parse};
use serde::Serialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    env,
    error::Error,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    net::{SocketAddr, TcpListener, TcpStream},
    path::{Component, Path, PathBuf},
    process::{Child, Command, ExitStatus, Stdio},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

type Result<T> = std::result::Result<T, Box<dyn Error>>;
#[path = "dp2/mod.rs"]
mod dp2;
const HELP: &str = "Native local CPU smoke; existing managed Linux container only.\n\
Usage: cargo run --offline --locked --manifest-path disputes/Cargo.toml --example real_smoke -- \\\n  --resources /absolute/resources.json --pins /absolute/runtime-pins.json \\\n  (--check | --run --capture-root /existing/absolute/capture-directory)\n\
--check verifies files and pins, starts no process and writes no capture.\n\
--run starts one owned loopback CPU server and one declared synthetic schedule.\n\
Without explicit --run or --check, nothing is read, written or started.\n";

#[derive(Clone, Copy, Debug, PartialEq)]
enum Mode {
    Check,
    Run,
}
#[derive(Debug)]
struct Options {
    mode: Mode,
    resources: PathBuf,
    pins: PathBuf,
    capture_root: Option<PathBuf>,
}

fn options(args: &[String]) -> Result<Option<Options>> {
    if args == ["--help"] || args == ["-h"] {
        return Ok(None);
    }
    // Refuse before interpreting file paths or performing any I/O.
    if !args.iter().any(|arg| arg == "--run" || arg == "--check") {
        return Err("Explicit --run or --check required; no action taken".into());
    }
    let (mut mode, mut resources, mut pins, mut capture_root) = (None, None, None, None);
    let mut args = args.iter();
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--run" | "--check" => {
                if mode.is_some() {
                    return Err("Choose exactly one of --run or --check".into());
                }
                mode = Some(if arg == "--run" {
                    Mode::Run
                } else {
                    Mode::Check
                });
            }
            "--resources" | "--pins" | "--capture-root" => {
                let value = args.next().ok_or("Missing administrative path argument")?;
                let path = PathBuf::from(value);
                if !path.is_absolute()
                    || path.components().any(|c| matches!(c, Component::ParentDir))
                {
                    return Err(
                        "Administrative paths must be absolute without parent traversal".into(),
                    );
                }
                let target = match arg.as_str() {
                    "--resources" => &mut resources,
                    "--pins" => &mut pins,
                    _ => &mut capture_root,
                };
                if target.replace(path).is_some() {
                    return Err("Duplicate administrative path argument".into());
                }
            }
            _ => return Err(format!("Unknown argument: {arg}").into()),
        }
    }
    let mode = mode.ok_or("Explicit mode required")?;
    if mode == Mode::Run && capture_root.is_none() {
        return Err("--run requires an existing --capture-root".into());
    }
    if mode == Mode::Check && capture_root.is_some() {
        return Err("--check does not use or write a capture root".into());
    }
    Ok(Some(Options {
        mode,
        resources: resources.ok_or("--resources required")?,
        pins: pins.ok_or("--pins required")?,
        capture_root,
    }))
}

fn save<T: Serialize>(capture: &Path, name: &str, value: &T) -> Result<()> {
    let file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(capture.join(name))?;
    // Avoid a host-mounted filesystem write for each JSON punctuation token.
    // Flush before syncing; preserve create-new ownership and exact output bytes.
    let mut writer = std::io::BufWriter::new(file);
    serde_json::to_writer_pretty(&mut writer, value)?;
    writer.write_all(b"\n")?;
    writer.flush()?;
    writer.get_ref().sync_all()?;
    Ok(())
}

fn read_json(path: &Path) -> Result<Value> {
    if fs::metadata(path)?.len() > 2 * 1024 * 1024 {
        return Err("Administrative JSON exceeds 2 MiB".into());
    }
    Ok(strict_parse(&fs::read(path)?)?)
}

fn sha256(path: &Path) -> Result<String> {
    let mut file = File::open(path)?;
    let mut digest = Sha256::new();
    let mut block = [0_u8; 64 * 1024];
    loop {
        let count = file.read(&mut block)?;
        if count == 0 {
            break;
        }
        digest.update(&block[..count]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn field<'a>(value: &'a Value, name: &str) -> Result<&'a str> {
    value
        .get(name)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("Missing string field: {name}").into())
}

fn allowed_artifact(path: &str, model: bool) -> Result<PathBuf> {
    let original = Path::new(path);
    if !original.is_absolute()
        || original
            .components()
            .any(|c| matches!(c, Component::ParentDir))
    {
        return Err("Artifact path must be absolute without parent traversal".into());
    }
    let actual = original.canonicalize()?;
    let roots = if model {
        &[
            "/opt/nonverba-models",
            "/opt/nonverba-tools/models",
            "/opt/nonverba-build/models",
        ][..]
    } else {
        &[
            "/opt/nonverba-tools/llama.cpp",
            "/opt/nonverba-tools/llama-cpp",
        ][..]
    };
    if !roots.iter().any(|root| actual.starts_with(root)) || !actual.is_file() {
        return Err("Artifact is outside the dedicated runtime/model directories".into());
    }
    if model && actual.extension().is_none_or(|s| s != "gguf")
        || !model && actual.file_name().is_none_or(|s| s != "llama-server")
    {
        return Err("Unsupported runtime/model filename".into());
    }
    Ok(actual)
}

fn verify(manifest: &Value, pins: &Value) -> Result<Value> {
    allowed_artifact(field(&manifest["model"], "path")?, true)?;
    allowed_artifact(field(manifest, "runtime_binary")?, false)?;
    if field(manifest, "runtime_commit")? != nonverba_disputes::runtime::LLAMA_CPP_COMMIT
        || field(pins, "llama_cpp_commit")? != nonverba_disputes::runtime::LLAMA_CPP_COMMIT
        || field(pins, "backend")? != "cpu"
        || field(pins, "quantization")? != "Q4_K_M"
        || manifest["model"]["sha256"] != pins["gguf_sha256"]
        || pins["gguf_sha256"] != pins["tokenizer_sha256"]
        || manifest["runtime_binary_sha256"] != pins["server_binary_sha256"]
    {
        return Err("Resource manifest and supported CPU specification pins disagree".into());
    }
    let mut artifacts = vec![
        manifest["model"].clone(),
        manifest["runtime_archive"].clone(),
        manifest["conversion_card"].clone(),
        json!({"path":manifest["runtime_binary"],"sha256":manifest["runtime_binary_sha256"]}),
    ];
    artifacts.extend(
        manifest["runtime_libraries"]
            .as_array()
            .ok_or("Missing runtime library manifest")?
            .iter()
            .cloned(),
    );
    let checks = artifacts.iter().map(|artifact| {
        let path = Path::new(field(artifact, "path")?);
        let expected = field(artifact, "sha256")?;
        let actual = sha256(path)?;
        let bytes = fs::metadata(path)?.len();
        Ok(json!({"path":path,"expected_sha256":expected,"actual_sha256":actual,"bytes":bytes,
            "matched":actual == expected && artifact.get("bytes").is_none_or(|n| n.as_u64() == Some(bytes))}))
    }).collect::<Result<Vec<_>>>()?;
    Ok(Value::Array(checks))
}

/// Every process is a direct child retained until reaped; no name-based termination.
struct OwnedChild(Child);
impl OwnedChild {
    fn stop(&mut self) -> Result<ExitStatus> {
        if let Some(status) = self.0.try_wait()? {
            return Ok(status);
        }
        // Child::kill targets only this still-owned unreaped child.
        self.0.kill()?;
        Ok(self.0.wait()?)
    }
}
impl Drop for OwnedChild {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

fn logged(command: &mut Command, capture: &Path, name: &str) -> Result<OwnedChild> {
    let log = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(capture.join(name))?;
    command
        .stdin(Stdio::null())
        .stdout(log.try_clone()?)
        .stderr(log);
    Ok(OwnedChild(command.spawn()?))
}

fn bounded_wait(child: &mut OwnedChild, seconds: u64) -> Result<ExitStatus> {
    let deadline = Instant::now() + Duration::from_secs(seconds);
    loop {
        if let Some(status) = child.0.try_wait()? {
            return Ok(status);
        }
        if Instant::now() >= deadline {
            child.stop()?;
            return Err("Owned child exceeded fixed deadline".into());
        }
        thread::sleep(Duration::from_millis(100));
    }
}

fn get(endpoint: SocketAddr, path: &str) -> Result<Value> {
    let deadline = Instant::now() + Duration::from_secs(2);
    let mut stream = TcpStream::connect_timeout(&endpoint, Duration::from_secs(1))?;
    stream.set_read_timeout(Some(Duration::from_millis(100)))?;
    stream.set_write_timeout(Some(Duration::from_secs(1)))?;
    write!(
        stream,
        "GET {path} HTTP/1.1\r\nHost: {endpoint}\r\nConnection: close\r\nAccept: application/json\r\n\r\n"
    )?;
    let mut bytes = Vec::new();
    let mut block = [0_u8; 8192];
    loop {
        if Instant::now() >= deadline {
            return Err("Loopback metadata request deadline".into());
        }
        match stream.read(&mut block) {
            Ok(0) => break,
            Ok(count) => bytes.extend_from_slice(&block[..count]),
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock
                ) =>
            {
                continue;
            }
            Err(error) => return Err(error.into()),
        }
        if bytes.len() > 2 * 1024 * 1024 {
            return Err("Loopback metadata response exceeds bound".into());
        }
    }
    let split = bytes
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .ok_or("Missing HTTP headers")?;
    if split > 16 * 1024 {
        return Err("Oversized HTTP headers".into());
    }
    let headers = std::str::from_utf8(&bytes[..split])?.to_ascii_lowercase();
    if !headers.starts_with("http/1.1 200 ")
        || headers.contains("transfer-encoding:")
        || headers.contains("content-encoding:")
    {
        return Err("Unsupported loopback metadata HTTP response".into());
    }
    Ok(strict_parse(&bytes[split + 4..])?)
}

fn execute(
    capture: &Path,
    manifest: &Value,
    pins: &Value,
    result: &mut Value,
    server: &mut Option<OwnedChild>,
) -> Result<()> {
    let cargo_args = [
        "test",
        "--offline",
        "--locked",
        "--manifest-path",
        "disputes/Cargo.toml",
        "--test",
        "real_local",
    ];
    let mut compile = Command::new("cargo");
    compile
        .args(cargo_args)
        .arg("--no-run")
        .arg("--message-format=json-render-diagnostics")
        .current_dir("/workspace/code");
    let compiled = bounded_wait(&mut logged(&mut compile, capture, "compile.log")?, 300)?;
    result["compile_exit_code"] = json!(compiled.code());
    if !compiled.success() {
        return Err("Real smoke test did not compile; see compile.log".into());
    }
    // Execute Cargo's observed test artifact directly, so the bounded test is
    // also an owned child rather than a grandchild left behind by a cargo timeout.
    let compile_log = fs::read_to_string(capture.join("compile.log"))?;
    let test_binary = compile_log
        .lines()
        .filter_map(|line| strict_parse::<Value>(line.as_bytes()).ok())
        .find_map(|record| {
            if record["reason"] == "compiler-artifact" && record["target"]["name"] == "real_local" {
                record["executable"].as_str().map(PathBuf::from)
            } else {
                None
            }
        })
        .ok_or("Cargo did not report the real_local test executable")?
        .canonicalize()?;
    let target =
        PathBuf::from(env::var_os("CARGO_TARGET_DIR").ok_or("Managed target directory missing")?)
            .canonicalize()?;
    if !test_binary.starts_with(target) || !test_binary.is_file() {
        return Err("Observed test executable escapes the managed Cargo target".into());
    }
    let reservation = TcpListener::bind("127.0.0.1:0")?;
    let endpoint = reservation.local_addr()?;
    let binary = field(manifest, "runtime_binary")?;
    let model = field(&manifest["model"], "path")?;
    let command = vec![
        binary.to_owned(),
        "--model".into(),
        model.into(),
        "--host".into(),
        "127.0.0.1".into(),
        "--port".into(),
        endpoint.port().to_string(),
        "--ctx-size".into(),
        "8192".into(),
        "--parallel".into(),
        "1".into(),
        "--threads".into(),
        "2".into(),
        "--threads-batch".into(),
        "2".into(),
        "--n-gpu-layers".into(),
        "0".into(),
        "--no-context-shift".into(),
        "--offline".into(),
        "--no-webui".into(),
        "--no-warmup".into(),
    ];
    save(
        capture,
        "admin-config.json",
        &json!({"endpoint":endpoint,"model_path":model,"server_binary_path":binary}),
    )?;
    save(capture, "server-command.json", &command)?;
    drop(reservation);
    *server = Some(logged(
        Command::new(binary).args(&command[1..]),
        capture,
        "server.log",
    )?);
    let owned = server.as_mut().ok_or("Owned server unavailable")?;
    result["owned_server_pid"] = json!(owned.0.id());
    let deadline = Instant::now() + Duration::from_secs(45);
    loop {
        if let Some(status) = owned.0.try_wait()? {
            return Err(format!("Owned server exited: {status}").into());
        }
        if get(endpoint, "/health").is_ok_and(|v| v["status"] == "ok") {
            break;
        }
        if Instant::now() >= deadline {
            return Err("Owned server startup timeout".into());
        }
        thread::sleep(Duration::from_millis(200));
    }
    let properties = get(endpoint, "/props")?;
    save(capture, "server-properties-before.json", &properties)?;
    if properties["build_info"] != pins["build_info_from_server"]
        || bytes_digest(field(&properties, "chat_template")?.as_bytes())
            != field(pins, "chat_template_sha256")?
    {
        return Err("Server build/template claims differ from resource pins".into());
    }
    let test_args = [
        "two_pass_real_smoke",
        "--ignored",
        "--nocapture",
        "--test-threads=1",
    ];
    save(
        capture,
        "test-command.json",
        &std::iter::once(test_binary.to_string_lossy().into_owned())
            .chain(test_args.iter().map(|s| (*s).to_owned()))
            .collect::<Vec<_>>(),
    )?;
    let mut test = Command::new(test_binary);
    test.args(test_args)
        .current_dir("/workspace/code")
        .env("NONVERBA_REAL_SMOKE_CAPTURE", capture);
    let tested = bounded_wait(&mut logged(&mut test, capture, "test.log")?, 480)?;
    result["test_exit_code"] = json!(tested.code());
    result["status"] = json!(if tested.success() {
        "PASSED"
    } else {
        "FAILED_CAPTURE_RETAINED"
    });
    save(
        capture,
        "server-properties-after.json",
        &get(endpoint, "/props")?,
    )?;
    Ok(())
}

fn run(options: Options) -> Result<bool> {
    if !cfg!(target_os = "linux") || env::var("NONVERBA_CONTAINER").as_deref() != Ok("1") {
        return Err("Use the existing managed Debian container via code/dev.sh exec".into());
    }
    let manifest = read_json(&options.resources)?;
    let pins = read_json(&options.pins)?;
    if options.mode == Mode::Check {
        let checks = verify(&manifest, &pins)?;
        let matched = checks
            .as_array()
            .is_some_and(|a| a.iter().all(|c| c["matched"] == true));
        println!(
            "{}",
            serde_json::to_string_pretty(
                &json!({"mode":"CHECK_ONLY","artifacts":checks,"all_matched":matched,"processes_started":0,"capture_written":false})
            )?
        );
        return Ok(matched);
    }
    let root = options
        .capture_root
        .ok_or("Missing capture root")?
        .canonicalize()?;
    if !root.is_dir() {
        return Err("Capture root must be an existing directory".into());
    }
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
    let capture = root.join(format!("rust-{nanos}-{}", std::process::id()));
    fs::create_dir(&capture)?;
    save(&capture, "resources.json", &manifest)?;
    save(&capture, "runtime-pins.json", &pins)?;
    let executable = env::current_exe()?;
    save(
        &capture,
        "driver-identity.json",
        &json!({"kind":"RUST_NATIVE_EXAMPLE","executable":executable,"executable_sha256":sha256(&executable)?,"resources_source":options.resources,"pins_source":options.pins}),
    )?;
    let mut result = json!({"status":"NOT_RUN","capture":capture,"backend":"cpu","gpu_used":false,"quality_validated":false,"new_context_required":true,"automatic_retry":false});
    let mut server = None;
    let execution = (|| -> Result<()> {
        let checks = verify(&manifest, &pins)?;
        save(&capture, "artifact-verification.json", &checks)?;
        if !checks
            .as_array()
            .is_some_and(|a| a.iter().all(|c| c["matched"] == true))
        {
            return Err("Provisioned artifact hash or size mismatch".into());
        }
        execute(&capture, &manifest, &pins, &mut result, &mut server)
    })();
    if let Err(error) = execution {
        result["status"] = json!("FAILED_CAPTURE_RETAINED");
        result["error"] = json!(error.to_string());
    }
    if let Some(owned) = &mut server {
        match owned.stop() {
            Ok(status) => {
                result["owned_server_stopped"] = json!(true);
                result["owned_server_exit_code"] = json!(status.code());
                result["owned_server_exit_status"] = json!(status.to_string());
            }
            Err(error) => {
                result["status"] = json!("FAILED_CAPTURE_RETAINED");
                result["owned_server_stopped"] = json!(false);
                result["cleanup_error"] = json!(error.to_string());
            }
        }
    } else {
        result["server_started"] = json!(false);
    }
    save(&capture, "driver-result.json", &result)?;
    println!("{}", serde_json::to_string(&result)?);
    Ok(result["status"] == "PASSED")
}

fn main() {
    let args = env::args().skip(1).collect::<Vec<_>>();
    if args.first().is_some_and(|arg| arg == "--demo-dp2") {
        match dp2::run(&args[1..]) {
            Ok(()) => return,
            Err(error) => {
                eprintln!("{error}");
                std::process::exit(1);
            }
        }
    }
    let options = match options(&args) {
        Ok(None) => {
            print!("{HELP}");
            return;
        }
        Ok(Some(options)) => options,
        Err(error) => {
            eprintln!("{error}\n{HELP}");
            std::process::exit(2);
        }
    };
    match run(options) {
        Ok(true) => (),
        Ok(false) => std::process::exit(1),
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|s| (*s).into()).collect()
    }
    #[test]
    fn no_opt_in_and_help_never_produce_executable_options() {
        assert!(options(&[]).is_err());
        assert!(options(&args(&["--resources", "/does-not-exist"])).is_err());
        assert!(options(&args(&["--help"])).unwrap().is_none());
        assert!(options(&args(&["--run"])).is_err());
        assert!(options(&args(&["--check", "--run"])).is_err());
    }
    #[test]
    fn check_is_explicit_and_has_no_capture_destination() {
        let checked = options(&args(&[
            "--check",
            "--resources",
            "/admin/resources.json",
            "--pins",
            "/admin/pins.json",
        ]))
        .unwrap()
        .unwrap();
        assert_eq!(checked.mode, Mode::Check);
        assert!(checked.capture_root.is_none());
        assert!(
            options(&args(&[
                "--check",
                "--resources",
                "/admin/resources.json",
                "--pins",
                "/admin/pins.json",
                "--capture-root",
                "/captures"
            ]))
            .is_err()
        );
    }

    #[test]
    fn buffered_capture_preserves_complete_bytes_and_refuses_overwrite() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = env::temp_dir().join(format!("nv-capture-{}-{unique}", std::process::id()));
        fs::create_dir(&directory).unwrap();
        let value = json!({"content":"x".repeat(20000),"stage":"EVIDENCE"});
        let expected = format!("{}\n", serde_json::to_string_pretty(&value).unwrap());
        save(&directory, "record.json", &value).unwrap();
        assert_eq!(
            fs::read(directory.join("record.json")).unwrap(),
            expected.as_bytes()
        );
        assert!(save(&directory, "record.json", &json!({"replacement":true})).is_err());
        assert_eq!(
            fs::read(directory.join("record.json")).unwrap(),
            expected.as_bytes()
        );
        fs::remove_file(directory.join("record.json")).unwrap();
        fs::remove_dir(directory).unwrap();
    }
}
