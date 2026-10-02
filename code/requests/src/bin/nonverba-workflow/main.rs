// SPDX-License-Identifier: AGPL-3.0-only
//! Bounded terminal adapter. The existing client remains the signing boundary.
mod drafts;
mod inspection;
mod review;

use nonverba_requests::{bundle, contract, crypto::KeyBinding, encoding, local, model::*};
use serde::Serialize;
use serde_json::Value;
use std::{
    io::{self, BufRead, IsTerminal, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
};
use zeroize::Zeroizing;

const HELP: &str = r#"Non Verba — guided SYNTHETIC development workflow (adapter 1 / protocol 2)

Each participant runs its own vault command and shares only its public binding.
No payment command moves money. No account, mediator server or reset can sign.

1. participant <R|O|M> <key-id> <new-vault> <new-public-key.json>
2. trust <R-public-key.json> <O-public-key.json> <M-public-key.json> <new-trust.json>
3. draft-request <trust.json> <new-request.json>
4. review request <request.json> <new-review.json>
   authorize <review.json> <trust.json> <your-vault> <new-signed-request.json>
5. draft-quote <signed-request.json> <trust.json> <new-quote.json>
   review quote <quote.json> <new-review.json> <signed-request.json>
   authorize <review.json> <trust.json> <O-vault> <new-signed-quote.json>
6. draft-contract <signed-request.json> <signed-quote.json> <trust.json> <new-bundle.json>
   review contract <bundle.json> <new-review.json>
   Each R/O/M: authorize <review.json> <trust.json> <your-vault> <new-endorsement.json>
   attach endorsement <bundle.json> <endorsement.json> <trust.json> <new-bundle.json>
7. inspect <bundle.json> <trust.json> [new-report.txt]
   retain <bundle.json> <trust.json> <your-encrypted-store>
8. demo-attachment <new-attachment.json>
   attach attachment <bundle.json> <attachment.json> <trust.json> <new-bundle.json>
   draft-event <completion|payer-observation|dispute> <bundle.json> <trust.json> <new-envelope.json>
   review event <envelope.json> <new-review.json> <bundle.json>
   authorize <review.json> <trust.json> <author-vault> <new-signed-event.json>
   attach event <bundle.json> <signed-event.json> <trust.json> <new-bundle.json>
9. draft-action <ack|receipt|settlement|reversal|activate> <bundle.json> <trust.json> <new-proposal.json> [target-id] [minor-units]
   review action <proposal.json> <new-review.json> <bundle.json>
   Each required signer: authorize <review.json> <trust.json> <your-vault> <new-signature.json>
   attach action <bundle.json> <signature.json> <trust.json> <new-bundle.json> <proposal.json>
10. merge <left-bundle.json> <right-bundle.json> <trust.json> <your-encrypted-store>
    export <encrypted-snapshot.json> <trust.json> <new-plaintext-bundle.json> <expected-root-digest>
    exchange <bundle.json> <trust.json> <new-plaintext-copy.json>
    inspect <received-bundle.json> <independently-pinned-trust.json> [new-report.txt]

Drafts are editable proposals. Review retains exact content and context immutably.
Authorize displays it, requires the full reviewed digest, then reads a passphrase.
Choose new file names. Existing records accept only identical bytes, never replacement.
Store each vault with its sibling signing-guards directory and its owner's passphrase.
Trust bindings must be checked independently; this demo does not establish identity.
Inspect every report: a successful command only means the report was generated.
An active fee, an expense conflict and false readiness can coexist.
Run only through the approved managed Linux container. See docs/requests/INTEGRATION.md.
Analysis extension: disputes guide (separately built nonverba-disputes sibling).
"#;

fn read<T: serde::de::DeserializeOwned>(path: &str) -> Result<T, String> {
    local::read_json(Path::new(path))
}
fn save<T: Serialize>(path: &str, value: &T) -> Result<(), String> {
    local::write_immutable(Path::new(path), &encoding::canonical(value)?)
}
pub(crate) fn terminal_safe_json(text: &str) -> String {
    let mut safe = String::with_capacity(text.len());
    for ch in text.chars() {
        if ('\u{0080}'..='\u{009f}').contains(&ch)
            || matches!(ch, '\u{200e}' | '\u{200f}' | '\u{2028}' | '\u{2029}' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
        {
            safe.push_str(&format!("\\u{:04x}", ch as u32));
        } else {
            safe.push(ch);
        }
    }
    safe
}
fn quoted(value: &str) -> String {
    terminal_safe_json(&serde_json::to_string(value).expect("serialize string"))
}

fn line() -> Result<String, String> {
    let mut result = String::new();
    io::stdin()
        .lock()
        .read_line(&mut result)
        .map_err(|e| format!("INPUT: {e}"))?;
    if result.ends_with('\n') {
        result.pop();
        if result.ends_with('\r') {
            result.pop();
        }
    }
    Ok(result)
}

struct EchoGuard(bool);
impl Drop for EchoGuard {
    fn drop(&mut self) {
        if self.0 {
            let _ = Command::new("stty")
                .arg("echo")
                .stdin(Stdio::inherit())
                .status();
            eprintln!();
        }
    }
}
fn secret() -> Result<Zeroizing<Vec<u8>>, String> {
    let terminal = io::stdin().is_terminal();
    if terminal
        && !Command::new("stty")
            .arg("-echo")
            .stdin(Stdio::inherit())
            .status()
            .map_err(|e| format!("PRIVATE_INPUT: {e}"))?
            .success()
    {
        return Err("PRIVATE_INPUT: unable to disable terminal echo".into());
    }
    let _guard = EchoGuard(terminal);
    eprint!("Local passphrase (12..4096 bytes): ");
    io::stderr().flush().map_err(|e| e.to_string())?;
    let mut bytes = Zeroizing::new(Vec::new());
    // Read from the same stdin buffer as the digest prompt; never put secrets in
    // command arguments, environment variables, exchange records or logs.
    use std::io::Read;
    io::stdin()
        .lock()
        .take(local::MAX_PASSPHRASE_BYTES as u64 + 2)
        .read_until(b'\n', &mut bytes)
        .map_err(|e| format!("INPUT: {e}"))?;
    if bytes.last() == Some(&b'\n') {
        bytes.pop();
        if bytes.last() == Some(&b'\r') {
            bytes.pop();
        }
    }
    if !(12..=local::MAX_PASSPHRASE_BYTES).contains(&bytes.len()) {
        return Err("VAULT_PASSPHRASE: expected 12..4096 bytes".into());
    }
    Ok(bytes)
}

fn client(arguments: &[String], passphrase: Option<&[u8]>) -> Result<Value, String> {
    let executable = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .with_file_name("nonverba-assignment");
    let mut child = Command::new(&executable)
        .args(arguments)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("CLIENT: build both binaries with cargo build --bins; {e}"))?;
    if let Some(password) = passphrase {
        let mut stdin = child
            .stdin
            .take()
            .ok_or("CLIENT: private input pipe absent")?;
        stdin
            .write_all(password)
            .and_then(|_| stdin.write_all(b"\n"))
            .map_err(|e| format!("CLIENT_INPUT: {e}"))?;
    } else {
        drop(child.stdin.take());
    }
    let output = child
        .wait_with_output()
        .map_err(|e| format!("CLIENT: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "CLIENT_REJECTED: {}",
            quoted(&String::from_utf8_lossy(&output.stderr))
        ));
    }
    if output.stdout.is_empty() {
        Ok(Value::Null)
    } else {
        serde_json::from_slice(&output.stdout).map_err(|e| format!("CLIENT_OUTPUT: {e}"))
    }
}

fn inspect(
    bundle: &AssignmentBundle,
    trust: &TrustConfiguration,
    output: Option<&str>,
) -> Result<(), String> {
    let report = bundle::verify_assignment_bundle(bundle, trust)?;
    let text = inspection::render(bundle, &report)?;
    if let Some(path) = output {
        local::write_immutable(Path::new(path), text.as_bytes())?;
    }
    print!("{text}");
    Ok(())
}

fn temp_review(record: &review::Review) -> Result<(PathBuf, PathBuf), String> {
    let target =
        std::env::var_os("CARGO_TARGET_DIR").ok_or("CONTAINER: CARGO_TARGET_DIR required")?;
    let mut random = [0u8; 16];
    getrandom::getrandom(&mut random).map_err(|e| format!("RANDOM: {e}"))?;
    let directory = PathBuf::from(target).join(format!("workflow-review-{}", hex::encode(random)));
    std::fs::create_dir(&directory).map_err(|e| format!("REVIEW_STORE: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700))
            .map_err(|e| format!("REVIEW_STORE: {e}"))?;
    }
    let object = directory.join("exact-content.json");
    let context = directory.join("retained-context.json");
    local::write_immutable(&object, &encoding::canonical(&record.exact_content)?)?;
    if let Some(value) = &record.retained_context {
        local::write_immutable(&context, &encoding::canonical(value)?)?;
    }
    Ok((object, context))
}

fn authorize(args: &[String]) -> Result<(), String> {
    let record: review::Review = read(&args[0])?;
    let trust: TrustConfiguration = read(&args[1])?;
    contract::validate_trust(&trust)?;
    print!("{}", record.render_verified(&trust)?);
    println!(
        "INDEPENDENTLY SUPPLIED TRUST\n{}",
        terminal_safe_json(&serde_json::to_string_pretty(&trust).map_err(|e| e.to_string())?)
    );
    eprint!("Type the full displayed digest to authorize, or leave blank to cancel: ");
    io::stderr().flush().map_err(|e| e.to_string())?;
    let approved = line()?;
    if approved.is_empty() {
        return Err("CONSENT_CANCELLED: nothing signed".into());
    }
    record.validate(&approved)?;
    let (object, context) = temp_review(&record)?;
    let object = object.to_str().ok_or("PATH: UTF-8 required")?.to_owned();
    let context = context.to_str().ok_or("PATH: UTF-8 required")?.to_owned();
    let tail = [args[1].clone(), args[2].clone(), args[3].clone(), approved];
    let command = match record.kind.as_str() {
        "request" => vec![
            "sign-request".into(),
            object,
            tail[0].clone(),
            tail[1].clone(),
            tail[2].clone(),
            tail[3].clone(),
        ],
        "quote" => vec![
            "sign-quote".into(),
            object,
            context,
            tail[0].clone(),
            tail[1].clone(),
            tail[2].clone(),
            tail[3].clone(),
        ],
        "agreement" => vec![
            "endorse".into(),
            context,
            tail[0].clone(),
            tail[1].clone(),
            tail[2].clone(),
            tail[3].clone(),
        ],
        "action" | "event" => vec![
            format!("sign-{}", record.kind),
            context,
            tail[0].clone(),
            object,
            tail[1].clone(),
            tail[2].clone(),
            tail[3].clone(),
        ],
        _ => return Err("REVIEW_KIND: unsupported".into()),
    };
    let password = secret()?;
    client(&command, Some(&password))?;
    println!(
        "Signed record retained at {}. Exchange this record; keep the vault and passphrase private.",
        quoted(&args[3])
    );
    Ok(())
}

fn run(arguments: &[String]) -> Result<(), String> {
    let (command, args) = arguments
        .split_first()
        .map(|(a, b)| (a.as_str(), b))
        .unwrap_or(("help", &[]));
    match (command, args.len()) {
        ("disputes", _) => {
            let executable = std::env::current_exe()
                .map_err(|e| format!("DISPUTE_EXECUTABLE: {e}"))?
                .with_file_name("nonverba-disputes");
            let status = Command::new(executable).args(args).status().map_err(|e| {
                format!("DISPUTE_EXECUTABLE: build the disputes companion in this container: {e}")
            })?;
            if status.success() {
                Ok(())
            } else {
                Err(format!("DISPUTE_COMMAND: companion returned {status}"))
            }
        }
        ("help" | "--help" | "guide", 0) => {
            print!("{HELP}");
            Ok(())
        }
        ("participant", 4) => {
            if !matches!(args[0].as_str(), "R" | "O" | "M") {
                return Err("ROLE: R, O or M required".into());
            }
            if Path::new(&args[2]).exists() || Path::new(&args[3]).exists() {
                return Err("IMMUTABLE_RECORD: choose new vault and public-key paths".into());
            }
            let password = secret()?;
            let result = client(
                &[
                    "keygen".into(),
                    args[0].clone(),
                    args[1].clone(),
                    args[2].clone(),
                ],
                Some(&password),
            )?;
            let key: KeyBinding = serde_json::from_value(result).map_err(|e| e.to_string())?;
            save(&args[3], &key)?;
            println!(
                "Share only {}. Keep {} and its signing guards in this participant's private directory.",
                quoted(&args[3]),
                quoted(&args[2])
            );
            Ok(())
        }
        ("trust", 4) => {
            let mut trust: TrustConfiguration =
                serde_json::from_str(include_str!("../../../tests/fixtures/trust.json"))
                    .map_err(|e| e.to_string())?;
            for (index, role) in [Role::Requester, Role::Operator, Role::Mediator]
                .iter()
                .enumerate()
            {
                let key: KeyBinding = read(&args[index])?;
                if key.role != role.code() {
                    return Err("KEY_AUTHORITY: public binding has wrong role".into());
                }
                trust
                    .parties
                    .iter_mut()
                    .find(|p| p.role == *role)
                    .ok_or("TRUST_TEMPLATE: role absent")?
                    .key = key;
            }
            contract::validate_trust(&trust)?;
            save(&args[3], &trust)?;
            println!(
                "Synthetic trust draft saved to {}. Independently confirm all three public bindings before using it.",
                quoted(&args[3])
            );
            Ok(())
        }
        ("draft-request", 2) => save(&args[1], &drafts::request(&read(&args[0])?)?),
        ("draft-quote", 3) => save(
            &args[2],
            &drafts::quote(&read(&args[0])?, &read(&args[1])?)?,
        ),
        ("draft-contract" | "draft-agreement", 4) => save(
            &args[3],
            &drafts::contract(read(&args[0])?, read(&args[1])?, &read(&args[2])?)?,
        ),
        ("draft-event", 4) => save(
            &args[3],
            &drafts::event(&args[0], &read(&args[1])?, &read(&args[2])?)?,
        ),
        ("draft-action", 4..=6) => save(
            &args[3],
            &drafts::action(
                &args[0],
                &read(&args[1])?,
                &read(&args[2])?,
                args.get(4).map(String::as_str),
                args.get(5).map(String::as_str),
            )?,
        ),
        ("demo-attachment", 1) => save(&args[0], &drafts::synthetic_attachment()?),
        ("review", 3..=4) => {
            let context = args.get(3).map(|p| read(p)).transpose()?;
            let record = review::Review::new(&args[0], read(&args[1])?, context)?;
            let rendered = record.render()?;
            save(&args[2], &record)?;
            print!("{rendered}");
            println!("Immutable review: {}", quoted(&args[2]));
            Ok(())
        }
        ("authorize", 4) => authorize(args),
        ("attach", 5..=6) => {
            let old: AssignmentBundle = read(&args[1])?;
            let proposal = args.get(5).map(|p| read(p)).transpose()?;
            let kind = if args[0] == "action" {
                "action-signature"
            } else {
                &args[0]
            };
            let updated = drafts::attach(kind, &old, read(&args[2])?, proposal)?;
            let trust: TrustConfiguration = read(&args[3])?;
            // A report is not blanket admission. Preserve partial/invalid records
            // and show their actual independent verifier outcomes.
            let report = bundle::verify_assignment_bundle(&updated, &trust)?;
            save(&args[4], &updated)?;
            print!("{}", inspection::render(&updated, &report)?);
            Ok(())
        }
        ("inspect", 2..=3) => inspect(
            &read(&args[0])?,
            &read(&args[1])?,
            args.get(2).map(String::as_str),
        ),
        ("retain", 3) | ("merge", 4) => {
            let (bundle, trust_path, store_path) = if command == "merge" {
                (
                    local::merge_bundles(&read(&args[0])?, &read(&args[1])?)?,
                    &args[2],
                    &args[3],
                )
            } else {
                (read(&args[0])?, &args[1], &args[2])
            };
            let trust = read(trust_path)?;
            let password = secret()?;
            let report =
                local::store_encrypted_snapshot(&bundle, &trust, Path::new(store_path), &password)?;
            println!(
                "Encrypted immutable snapshot: {}",
                quoted(
                    &local::encrypted_snapshot_path(&bundle, Path::new(store_path))?
                        .to_string_lossy()
                )
            );
            print!("{}", inspection::render(&bundle, &report)?);
            Ok(())
        }
        ("export", 4) => {
            let trust = read(&args[1])?;
            let password = secret()?;
            let bundle = local::load_encrypted_snapshot(Path::new(&args[0]), &password, &args[3])?;
            let report = bundle::verify_assignment_bundle(&bundle, &trust)?;
            save(&args[2], &bundle)?;
            println!("Explicit plaintext export: {}", quoted(&args[2]));
            print!("{}", inspection::render(&bundle, &report)?);
            Ok(())
        }
        ("exchange", 3) => {
            let source: AssignmentBundle = read(&args[0])?;
            let trust = read(&args[1])?;
            bundle::verify_assignment_bundle(&source, &trust)?;
            save(&args[2], &source)?;
            inspect(&source, &trust, None)
        }
        _ => Err(format!(
            "USAGE: unsupported command or argument count\n{HELP}"
        )),
    }
}

fn main() {
    if !cfg!(target_os = "linux") || std::env::var("NONVERBA_CONTAINER").as_deref() != Ok("1") {
        eprintln!(
            "CONTAINER: run the guided development workflow through the managed Linux container"
        );
        std::process::exit(1);
    }
    if let Err(error) = run(&std::env::args().skip(1).collect::<Vec<_>>()) {
        eprintln!("{}", quoted(&error));
        std::process::exit(1);
    }
}
