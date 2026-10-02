// SPDX-License-Identifier: AGPL-3.0-only
//! Independent local command line client. No network, mediator session or API.
use nonverba_requests::{
    actions, agreement, bundle, crypto, encoding, local, model::*, transcript,
};
use std::{
    io::{self, BufRead, Read},
    path::Path,
};
use zeroize::Zeroizing;

const HELP: &str = "Non Verba independent Assignment client\n\n\
keygen <R|O|M> <key-id> <new-vault-file>\n\
preview <bundle.json>\n\
verify <bundle.json> <independent-trust.json>\n\
inspect-json <protocol-object.json>\n\
sign-request <request.json> <trust.json> <vault> <new-signed-request.json> <reviewed-request-digest>\n\
sign-quote <quote.json> <signed-request.json> <trust.json> <vault> <new-signed-quote.json> <reviewed-quote-digest>\n\
endorse <bundle.json> <trust.json> <vault> <new-signature.json> <reviewed-agreement-digest>\n\
sign-action <bundle.json> <trust.json> <proposal.json> <vault> <new-signature.json> <reviewed-proposal-digest>\n\
sign-event <bundle.json> <trust.json> <envelope.json> <vault> <new-signed-event.json> <reviewed-envelope-digest>\n\
import <bundle.json> <trust.json> <local-store-directory>\n\
merge <left-bundle.json> <right-bundle.json> <trust.json> <local-store-directory>\n\
export <bundle.json> <new-export.json>\n\
export-store <encrypted-snapshot.json> <trust.json> <new-plaintext-bundle.json> <expected-root-digest>\n\
seal-evidence <plaintext-file> <new-encrypted-file> <public-context>\n\
open-evidence <encrypted-file> <new-plaintext-file> <expected-public-context>\n\n\
Vault/evidence/import/merge/export-store commands read one passphrase line from stdin (12..4096 bytes).\n\
Imports/merges encrypt local snapshots. Explicit exports contain plaintext; choose intended recipients.\n\
Review exact preview/proposal bytes and supply their digest before signing.\n\
Software vault only; keep its directory, passphrase, trusted client and guards private.\n\
Never restore/copy a vault without its signing-guards directory. Windows files inherit directory ACLs.\n\
The verifier reports only supplied history; verification does not prove physical work or payment.\n";

fn passphrase() -> Result<Zeroizing<Vec<u8>>, String> {
    eprintln!(
        "Read passphrase from stdin; use a private input mechanism (terminal input may be echoed)."
    );
    let mut bytes = Zeroizing::new(Vec::new());
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

fn output<T: serde::Serialize>(value: &T) -> Result<(), String> {
    println!(
        "{}",
        serde_json::to_string_pretty(value).map_err(|e| format!("OUTPUT: {e}"))?
    );
    Ok(())
}

fn role(code: &str) -> Result<Role, String> {
    match code {
        "R" => Ok(Role::Requester),
        "O" => Ok(Role::Operator),
        "M" => Ok(Role::Mediator),
        _ => Err("KEY_AUTHORITY: unsupported role".into()),
    }
}

fn confirm_hash<T: serde::Serialize>(object: &T, expected: &str) -> Result<String, String> {
    encoding::validate_digest(expected)?;
    let actual = encoding::digest(object)?;
    if actual != expected {
        return Err(
            "CONSENT_DIGEST: supplied reviewed digest differs from exact bytes to be signed".into(),
        );
    }
    Ok(actual)
}

fn endorse(args: &[String]) -> Result<(), String> {
    let bundle: AssignmentBundle = local::read_json(Path::new(&args[0]))?;
    let trust: TrustConfiguration = local::read_json(Path::new(&args[1]))?;
    let agreement = &bundle.agreement.agreement;
    agreement::validate_agreement(agreement, &bundle.requests, &trust)?;
    let result = agreement::verify_agreement(&bundle.agreement, &bundle.requests, &trust);
    if let Some(problem) = result
        .diagnostics
        .iter()
        .find(|d| d.code != "MISSING_SIGNATURE")
    {
        return Err(format!("{}: {}", problem.code, problem.message));
    }
    let hash = confirm_hash(agreement, &args[4])?;
    let vault_path = Path::new(&args[2]);
    let (key, binding) = local::unlock_vault(vault_path, &passphrase()?)?;
    let party = agreement::party(agreement, role(&binding.role)?)?;
    if party.key != binding {
        return Err(
            "KEY_AUTHORITY: local vault is not this Agreement's independently trusted role key"
                .into(),
        );
    }
    let claims = agreement::claims(
        &agreement.deployment_domain,
        &agreement.assignment_id,
        &hash,
        party,
        "AGREEMENT",
    );
    if binding.role == "R" {
        local::reserve_signing_slot(
            &local::guard_directory(vault_path)?,
            &local::ExclusiveSlot {
                deployment_domain: agreement.deployment_domain.clone(),
                assignment_id: agreement.request_id.clone(),
                key_id: binding.key_id.clone(),
                scope_id: "request-assignment".into(),
                scope_version: "0".into(),
            },
            &encoding::digest(&agreement.assignment_id)?,
        )?;
    }
    local::reserve_signing_slot(
        &local::guard_directory(vault_path)?,
        &local::ExclusiveSlot {
            deployment_domain: agreement.deployment_domain.clone(),
            assignment_id: agreement.assignment_id.clone(),
            key_id: binding.key_id,
            scope_id: "terms".into(),
            scope_version: "0".into(),
        },
        &hash,
    )?;
    let signature = crypto::sign(&claims, &key)?;
    local::write_immutable(Path::new(&args[3]), &encoding::canonical(&signature)?)?;
    output(&signature)
}

fn sign_request(args: &[String]) -> Result<(), String> {
    let request: Request = local::read_json(Path::new(&args[0]))?;
    if request.protocol_version != PROTOCOL_VERSION {
        return Err("VERSION: new Request signatures require protocol 2; legacy material is inspection-only".into());
    }
    let trust: TrustConfiguration = local::read_json(Path::new(&args[1]))?;
    agreement::validate_trust(&trust)?;
    let hash = confirm_hash(&request, &args[4])?;
    let vault_path = Path::new(&args[2]);
    let (key, binding) = local::unlock_vault(vault_path, &passphrase()?)?;
    let trusted = trust
        .parties
        .iter()
        .find(|p| p.role == Role::Requester)
        .ok_or_else(|| "KEY_AUTHORITY: trusted Requester absent".to_owned())?;
    if binding != trusted.key || request.requester != *trusted {
        return Err(
            "KEY_AUTHORITY: only the independently trusted Requester may sign its Request".into(),
        );
    }
    let claims = agreement::claims(
        &request.deployment_domain,
        &request.request_id,
        &hash,
        trusted,
        "REQUEST",
    );
    local::reserve_signing_slot(
        &local::guard_directory(vault_path)?,
        &local::ExclusiveSlot {
            deployment_domain: request.deployment_domain.clone(),
            assignment_id: request.request_id.clone(),
            key_id: binding.key_id,
            scope_id: "request".into(),
            scope_version: request.revision.clone(),
        },
        &hash,
    )?;
    let signed = SignedRequest {
        authorization: crypto::sign(&claims, &key)?,
        request,
    };
    agreement::verify_request(&signed, &trust)?;
    local::write_immutable(Path::new(&args[3]), &encoding::canonical(&signed)?)?;
    output(&signed)
}

fn sign_quote(args: &[String]) -> Result<(), String> {
    let quote: Quote = local::read_json(Path::new(&args[0]))?;
    if quote.protocol_version != PROTOCOL_VERSION {
        return Err(
            "VERSION: new Quote signatures require protocol 2; legacy material is inspection-only"
                .into(),
        );
    }
    let request: SignedRequest = local::read_json(Path::new(&args[1]))?;
    let trust: TrustConfiguration = local::read_json(Path::new(&args[2]))?;
    agreement::verify_request(&request, &trust)?;
    let hash = confirm_hash(&quote, &args[5])?;
    let vault_path = Path::new(&args[3]);
    let (key, binding) = local::unlock_vault(vault_path, &passphrase()?)?;
    let trusted = trust
        .parties
        .iter()
        .find(|p| p.role == Role::Operator)
        .ok_or_else(|| "KEY_AUTHORITY: trusted Operator absent".to_owned())?;
    if binding != trusted.key || quote.operator != *trusted {
        return Err(
            "KEY_AUTHORITY: only the independently trusted Operator may author a quote".into(),
        );
    }
    let claims = agreement::claims(
        &quote.deployment_domain,
        &request.request.request_id,
        &hash,
        trusted,
        "QUOTE",
    );
    local::reserve_signing_slot(
        &local::guard_directory(vault_path)?,
        &local::ExclusiveSlot {
            deployment_domain: quote.deployment_domain.clone(),
            assignment_id: request.request.request_id.clone(),
            key_id: binding.key_id,
            scope_id: format!("quote:{}", encoding::digest(&quote.quote_id)?),
            scope_version: "0".into(),
        },
        &hash,
    )?;
    let signed = SignedQuote {
        authorization: crypto::sign(&claims, &key)?,
        quote,
    };
    agreement::verify_quote(&signed, &request, &trust)?;
    local::write_immutable(Path::new(&args[4]), &encoding::canonical(&signed)?)?;
    output(&signed)
}

fn sign_event(args: &[String]) -> Result<(), String> {
    let mut bundle: AssignmentBundle = local::read_json(Path::new(&args[0]))?;
    let trust: TrustConfiguration = local::read_json(Path::new(&args[1]))?;
    let envelope: transcript::EventEnvelope = local::read_json(Path::new(&args[2]))?;
    let report = bundle::verify_assignment_bundle(&bundle, &trust)?;
    if !report.agreement.bound {
        return Err("LOCAL_UNBOUND: retain a complete verified R/O/M certificate before signing Assignment events".into());
    }
    if envelope.protocol_version != PROTOCOL_VERSION || bundle.protocol_version != PROTOCOL_VERSION
    {
        return Err("EVENT_VERSION: legacy material is inspection-only; fresh signatures require an explicit policy-2 Agreement".into());
    }
    if envelope.agreement_hash != report.current_agreement_hash {
        return Err(
            "EVENT_AGREEMENT: envelope must reference the current locally authorized Agreement"
                .into(),
        );
    }
    let hash = confirm_hash(&envelope, &args[5])?;
    let vault_path = Path::new(&args[3]);
    let (key, binding) = local::unlock_vault(vault_path, &passphrase()?)?;
    let party = agreement::party(&bundle.agreement.agreement, role(&binding.role)?)?;
    if party.key != binding
        || envelope.author_role != binding.role
        || envelope.key_id != binding.key_id
    {
        return Err(
            "KEY_AUTHORITY: event author differs from independently trusted local key".into(),
        );
    }
    local::reserve_signing_slot(
        &local::guard_directory(vault_path)?,
        &local::ExclusiveSlot {
            deployment_domain: envelope.deployment_domain.clone(),
            assignment_id: envelope.assignment_id.clone(),
            key_id: binding.key_id,
            scope_id: format!("stream:{}", envelope.key_epoch),
            scope_version: envelope.sequence.clone(),
        },
        &hash,
    )?;
    let signed = transcript::sign_event(&envelope, &key)?;
    bundle.events.push(signed.clone());
    let updated = bundle::verify_assignment_bundle(&bundle, &trust)?;
    if !updated.transcript.accepted.contains_key(&hash) {
        return Err("EVENT_LOCAL_POLICY: candidate is invalid, conflicted, or lacks causal dependencies; reservation retained".into());
    }
    local::write_immutable(Path::new(&args[4]), &encoding::canonical(&signed)?)?;
    output(&signed)
}

fn sign_action(args: &[String]) -> Result<(), String> {
    let bundle: AssignmentBundle = local::read_json(Path::new(&args[0]))?;
    let trust: TrustConfiguration = local::read_json(Path::new(&args[1]))?;
    let proposal: ActionProposal = local::read_json(Path::new(&args[2]))?;
    let hash = confirm_hash(&proposal, &args[5])?;
    let vault_path = Path::new(&args[3]);
    let (key, binding) = local::unlock_vault(vault_path, &passphrase()?)?;
    let claims =
        actions::prepare_action_signature(&proposal, &bundle, &trust, role(&binding.role)?)?;
    let party = agreement::party(&bundle.agreement.agreement, role(&binding.role)?)?;
    if party.key != binding || claims.key_id != binding.key_id {
        return Err("KEY_AUTHORITY: local vault is not the independently trusted signer".into());
    }
    if claims.content_hash != hash
        || claims.deployment_domain != proposal.deployment_domain
        || claims.assignment_id != proposal.assignment_id
        || claims.role != binding.role
    {
        return Err(
            "CONSENT_CONTEXT: prepared signature differs from the reviewed proposal or local role"
                .into(),
        );
    }
    local::reserve_signing_slot(
        &local::guard_directory(vault_path)?,
        &local::ExclusiveSlot {
            deployment_domain: proposal.deployment_domain.clone(),
            assignment_id: proposal.assignment_id.clone(),
            key_id: binding.key_id,
            scope_id: proposal.scope_id.clone(),
            scope_version: proposal.scope_version.clone(),
        },
        &hash,
    )?;
    let signature = crypto::sign(&claims, &key)?;
    local::write_immutable(Path::new(&args[4]), &encoding::canonical(&signature)?)?;
    output(&signature)
}

fn run(args: &[String]) -> Result<(), String> {
    let (command, rest) = args
        .split_first()
        .map(|(a, b)| (a.as_str(), b))
        .unwrap_or(("--help", &[]));
    match (command, rest.len()) {
        ("--help" | "-h" | "help", 0) => {
            print!("{HELP}");
            Ok(())
        }
        ("keygen", 3) => output(&local::create_vault(
            Path::new(&rest[2]),
            &rest[0],
            &rest[1],
            &passphrase()?,
        )?),
        ("preview", 1) => {
            let b: AssignmentBundle = local::read_json(Path::new(&rest[0]))?;
            println!("{}", agreement::preview(&b.agreement.agreement)?);
            Ok(())
        }
        ("verify", 2) => {
            let b: AssignmentBundle = local::read_json(Path::new(&rest[0]))?;
            let t: TrustConfiguration = local::read_json(Path::new(&rest[1]))?;
            output(&bundle::verify_assignment_bundle(&b, &t)?)
        }
        ("inspect-json", 1) => {
            let value: serde_json::Value = local::read_json(Path::new(&rest[0]))?;
            output(
                &serde_json::json!({"digest": encoding::digest(&value)?, "exact_content": value}),
            )
        }
        ("sign-request", 5) => sign_request(rest),
        ("sign-quote", 6) => sign_quote(rest),
        ("endorse", 5) => endorse(rest),
        ("sign-action", 6) => sign_action(rest),
        ("sign-event", 6) => sign_event(rest),
        ("import", 3) => {
            let b: AssignmentBundle = local::read_json(Path::new(&rest[0]))?;
            let t: TrustConfiguration = local::read_json(Path::new(&rest[1]))?;
            let directory = Path::new(&rest[2]);
            let report = local::store_encrypted_snapshot(&b, &t, directory, &passphrase()?)?;
            output(
                &serde_json::json!({"snapshot_path": local::encrypted_snapshot_path(&b, directory)?, "report": report}),
            )
        }
        ("merge", 4) => {
            let left: AssignmentBundle = local::read_json(Path::new(&rest[0]))?;
            let right: AssignmentBundle = local::read_json(Path::new(&rest[1]))?;
            let t: TrustConfiguration = local::read_json(Path::new(&rest[2]))?;
            let combined = local::merge_bundles(&left, &right)?;
            let directory = Path::new(&rest[3]);
            let report = local::store_encrypted_snapshot(&combined, &t, directory, &passphrase()?)?;
            output(
                &serde_json::json!({"snapshot_path": local::encrypted_snapshot_path(&combined, directory)?, "report": report}),
            )
        }
        ("export", 2) => {
            let b: AssignmentBundle = local::read_json(Path::new(&rest[0]))?;
            local::write_immutable(Path::new(&rest[1]), &encoding::canonical(&b)?)
        }
        ("export-store", 4) => {
            let b = local::load_encrypted_snapshot(Path::new(&rest[0]), &passphrase()?, &rest[3])?;
            let t: TrustConfiguration = local::read_json(Path::new(&rest[1]))?;
            bundle::verify_assignment_bundle(&b, &t)?;
            local::write_immutable(Path::new(&rest[2]), &encoding::canonical(&b)?)
        }
        ("seal-evidence", 3) => {
            let plaintext = Zeroizing::new(local::read_bytes(Path::new(&rest[0]))?);
            let encrypted = local::seal_evidence(&plaintext, &passphrase()?, &rest[2])?;
            local::write_immutable(Path::new(&rest[1]), &encoding::canonical(&encrypted)?)
        }
        ("open-evidence", 3) => {
            let encrypted: local::EncryptedRecord = local::read_json(Path::new(&rest[0]))?;
            let plaintext = local::open_evidence(&encrypted, &passphrase()?, &rest[2])?;
            local::write_immutable(Path::new(&rest[1]), &plaintext)
        }
        _ => Err(format!(
            "USAGE: unsupported command or argument count\n{HELP}"
        )),
    }
}

fn main() {
    if let Err(error) = run(&std::env::args().skip(1).collect::<Vec<_>>()) {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
