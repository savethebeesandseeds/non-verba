// SPDX-License-Identifier: AGPL-3.0-only
use nonverba_requests::{crypto, encoding, local::*};
use std::{fs, path::PathBuf};
mod common;

fn temporary(name: &str) -> PathBuf {
    let suffix = crypto::encode_base64url(&crypto::fresh_salt().unwrap());
    let directory = std::env::temp_dir().join(format!("nonverba-{name}-{suffix}"));
    fs::create_dir(&directory).unwrap();
    directory
}

#[test]
fn vault_roundtrip_wrong_password_and_header_tamper() {
    let directory = temporary("vault");
    let path = directory.join("operator.vault");
    let passphrase = b"correct horse battery staple";
    let public = create_vault(&path, "O", "key-o", passphrase).unwrap();
    let (key, reopened) = unlock_vault(&path, passphrase).unwrap();
    assert_eq!(public, reopened);
    assert_eq!(crypto::key_binding("O", "key-o", &key), public);
    assert!(
        unlock_vault(&path, b"incorrect horse battery staple")
            .unwrap_err()
            .starts_with("VAULT_AUTHENTICATION:")
    );
    assert!(
        create_vault(&path, "O", "key-o", passphrase)
            .unwrap_err()
            .starts_with("LOCAL_EXISTS:")
    );
    let original = fs::read(&path).unwrap();
    let mut tampered: EncryptedRecord = encoding::strict_parse(&original).unwrap();
    tampered.header.key_binding.as_mut().unwrap().role = "R".into();
    let tampered_path = directory.join("altered.vault");
    write_immutable(&tampered_path, &encoding::canonical(&tampered).unwrap()).unwrap();
    assert!(
        unlock_vault(&tampered_path, passphrase)
            .unwrap_err()
            .starts_with("VAULT_AUTHENTICATION:")
    );
    assert!(create_vault(&directory.join("short.vault"), "R", "key-r", b"short").is_err());
    fs::remove_dir_all(directory).unwrap();
}

#[test]
fn evidence_encryption_is_purpose_and_context_bound() {
    let passphrase = b"evidence secret with enough length";
    let encrypted = seal_evidence(
        b"private evidence bytes",
        passphrase,
        "assignment-1/evidence-1",
    )
    .unwrap();
    assert_eq!(
        open_evidence(&encrypted, passphrase, "assignment-1/evidence-1")
            .unwrap()
            .as_slice(),
        b"private evidence bytes"
    );
    assert!(open_evidence(&encrypted, passphrase, "assignment-2/evidence-1").is_err());
    let mut altered = encrypted.clone();
    let mut ciphertext = crypto::decode_base64url(
        &altered.ciphertext_b64,
        altered.header.plaintext_bytes as usize + 16,
    )
    .unwrap();
    ciphertext[0] ^= 1;
    altered.ciphertext_b64 = crypto::encode_base64url(&ciphertext);
    assert!(open_evidence(&altered, passphrase, "assignment-1/evidence-1").is_err());
    let mut wrong_kdf = encrypted;
    wrong_kdf.header.iterations = 1;
    assert!(
        open_evidence(&wrong_kdf, passphrase, "assignment-1/evidence-1")
            .unwrap_err()
            .starts_with("VAULT_PROFILE:")
    );
}

#[test]
fn durable_guard_refuses_conflicts_and_partial_crash_records() {
    let directory = temporary("guard");
    let slot = ExclusiveSlot {
        deployment_domain: "nonverba.local/test".into(),
        assignment_id: "assignment-1".into(),
        key_id: "key-o".into(),
        scope_id: "terms".into(),
        scope_version: "0".into(),
    };
    let first = encoding::bytes_digest(b"first exact proposal");
    reserve_signing_slot(&directory, &slot, &first).unwrap();
    reserve_signing_slot(&directory, &slot, &first).unwrap();
    assert!(
        reserve_signing_slot(
            &directory,
            &slot,
            &encoding::bytes_digest(b"changed parents or body")
        )
        .unwrap_err()
        .starts_with("SIGNER_CONFLICT:")
    );
    let next = ExclusiveSlot {
        scope_version: "1".into(),
        ..slot
    };
    let crash_file = directory.join(format!("{}.json", encoding::digest(&next).unwrap()));
    fs::write(&crash_file, b"{partial").unwrap();
    assert!(
        reserve_signing_slot(&directory, &next, &first)
            .unwrap_err()
            .starts_with("SIGNER_CONFLICT:")
    );
    assert_eq!(fs::read(crash_file).unwrap(), b"{partial");
    fs::remove_dir_all(directory).unwrap();
}

#[test]
fn local_records_are_immutable_and_read_back() {
    let directory = temporary("immutable");
    let path = directory.join("record.json");
    write_immutable(&path, b"{\"value\":1}").unwrap();
    write_immutable(&path, b"{\"value\":1}").unwrap();
    assert!(
        write_immutable(&path, b"{\"value\":2}")
            .unwrap_err()
            .starts_with("LOCAL_IMMUTABLE:")
    );
    assert_eq!(read_bytes(&path).unwrap(), b"{\"value\":1}");
    fs::remove_dir_all(directory).unwrap();
}

#[test]
fn concurrent_signer_reservations_never_authorize_two_digests() {
    use std::sync::{Arc, Barrier};
    let directory = temporary("concurrent-guard");
    let slot = ExclusiveSlot {
        deployment_domain: "nonverba.local/test".into(),
        assignment_id: "assignment-1".into(),
        key_id: "key-r".into(),
        scope_id: "terms".into(),
        scope_version: "1".into(),
    };
    let barrier = Arc::new(Barrier::new(2));
    let handles: Vec<_> = [b"proposal A", b"proposal B"]
        .into_iter()
        .map(|proposal| {
            let barrier = barrier.clone();
            let directory = directory.clone();
            let slot = slot.clone();
            std::thread::spawn(move || {
                barrier.wait();
                reserve_signing_slot(&directory, &slot, &encoding::bytes_digest(proposal))
            })
        })
        .collect();
    let results: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();
    assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 1);
    assert_eq!(results.iter().filter(|r| r.is_err()).count(), 1);
    fs::remove_dir_all(directory).unwrap();
}

#[test]
fn evidence_bundle_defaults_to_authenticated_encrypted_retention() {
    let directory = temporary("encrypted-snapshot");
    let (mut bundle, trust, keys) = common::fixture();
    common::completion(&mut bundle, &keys);
    assert!(
        store_snapshot(&bundle, &trust, &directory)
            .unwrap_err()
            .starts_with("LOCAL_PRIVACY:")
    );
    let passphrase = b"private retained bundle password";
    let report = store_encrypted_snapshot(&bundle, &trust, &directory, passphrase).unwrap();
    assert!(report.agreement.bound);
    let path = encrypted_snapshot_path(&bundle, &directory).unwrap();
    let at_rest = fs::read_to_string(&path).unwrap();
    assert!(!at_rest.contains(&crypto::encode_base64url(common::EVIDENCE_BYTES)));
    let root_hash = encoding::digest(&bundle.agreement.agreement).unwrap();
    let reopened = load_encrypted_snapshot(&path, passphrase, &root_hash).unwrap();
    assert_eq!(
        encoding::digest(&bundle).unwrap(),
        encoding::digest(&reopened).unwrap()
    );
    assert!(
        load_encrypted_snapshot(
            &path,
            passphrase,
            &encoding::bytes_digest(b"different root")
        )
        .is_err()
    );
    store_encrypted_snapshot(&bundle, &trust, &directory, passphrase).unwrap();
    assert_eq!(
        fs::read_to_string(&path).unwrap(),
        at_rest,
        "identical imports must retain existing ciphertext"
    );
    fs::remove_dir_all(directory).unwrap();
}

#[test]
fn bundle_merge_combines_partial_signatures_and_preserves_conflicting_records() {
    use nonverba_requests::{bundle, model::Role, transcript::EventBody};
    let (mut left, trust, keys) = common::fixture();
    let mut right = left.clone();
    left.agreement.signatures.truncate(1);
    right.agreement.signatures.remove(0);
    let first = common::event(
        &left,
        &keys,
        Role::Operator,
        0,
        None,
        vec![],
        EventBody::StartClaim,
    );
    let second = common::event(
        &left,
        &keys,
        Role::Operator,
        0,
        None,
        vec![],
        EventBody::CancellationNotice {
            reason: "Conflicting same-sequence signed notice".into(),
        },
    );
    left.events.push(first);
    right.events.push(second);
    let combined = merge_bundles(&left, &right).unwrap();
    assert_eq!(combined.events.len(), 2);
    let report = bundle::verify_assignment_bundle(&combined, &trust).unwrap();
    assert!(report.agreement.bound);
    assert!(!report.transcript.conflicts.is_empty());
    let idempotent = merge_bundles(&combined, &combined).unwrap();
    assert_eq!(
        encoding::digest(&combined).unwrap(),
        encoding::digest(&idempotent).unwrap()
    );
    right.agreement.agreement.payments.destination = "unauthorized-destination".into();
    assert!(
        merge_bundles(&left, &right)
            .unwrap_err()
            .starts_with("IMPORT_ROOT:")
    );
}

#[test]
fn cli_signs_real_request_from_user_vault_with_exact_digest_consent() {
    use nonverba_requests::{contract, model::SignedRequest};
    use std::{
        io::Write,
        process::{Command, Stdio},
    };
    let directory = temporary("cli-request");
    let vault = directory.join("requester.vault");
    let password = b"requester independently owned vault";
    let binding = create_vault(&vault, "R", "test-local-key-r", password).unwrap();
    let (bundle, mut trust, _) = common::fixture();
    trust.parties[0].key = binding;
    let mut request = bundle.requests[0].request.clone();
    request.requester = trust.parties[0].clone();
    let request_file = directory.join("request.json");
    let trust_file = directory.join("trust.json");
    let signature_file = directory.join("signed-request.json");
    write_immutable(&request_file, &encoding::canonical(&request).unwrap()).unwrap();
    write_immutable(&trust_file, &encoding::canonical(&trust).unwrap()).unwrap();
    let mut child = Command::new(env!("CARGO_BIN_EXE_nonverba-assignment"))
        .arg("sign-request")
        .arg(&request_file)
        .arg(&trust_file)
        .arg(&vault)
        .arg(&signature_file)
        .arg(encoding::digest(&request).unwrap())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.take().unwrap().write_all(password).unwrap();
    let result = child.wait_with_output().unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let signed: SignedRequest = read_json(&signature_file).unwrap();
    contract::verify_request(&signed, &trust).unwrap();
    assert_eq!(
        fs::read_dir(guard_directory(&vault).unwrap())
            .unwrap()
            .count(),
        1
    );
    let wrong_digest = Command::new(env!("CARGO_BIN_EXE_nonverba-assignment"))
        .arg("sign-request")
        .arg(&request_file)
        .arg(&trust_file)
        .arg(directory.join("missing-vault"))
        .arg(directory.join("never-created.json"))
        .arg(encoding::bytes_digest(b"unreviewed bytes"))
        .output()
        .unwrap();
    assert!(!wrong_digest.status.success());
    assert!(String::from_utf8_lossy(&wrong_digest.stderr).contains("CONSENT_DIGEST:"));
    fs::remove_dir_all(directory).unwrap();
}

fn cli_call(command: &str, arguments: &[String], password: Option<&[u8]>) -> std::process::Output {
    use std::{
        io::Write,
        process::{Command, Stdio},
    };
    let mut child = Command::new(env!("CARGO_BIN_EXE_nonverba-assignment"))
        .arg(command)
        .args(arguments)
        .stdin(if password.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    if let Some(password) = password {
        child.stdin.take().unwrap().write_all(password).unwrap();
    }
    child.wait_with_output().unwrap()
}

#[test]
fn legacy_request_and_quote_refuse_before_unlocking_or_reserving_signing_slots() {
    let directory = temporary("legacy-signing-boundary");
    let (bundle, trust, _) = common::fixture();
    let trust_file = directory.join("trust.json");
    let request_file = directory.join("signed-request.json");
    save_test_object(&trust_file, &trust);
    save_test_object(&request_file, &bundle.requests[0]);
    let vault = directory.join("must-not-be-opened.vault");
    let output = directory.join("must-not-be-signed.json");
    let mut legacy_request = bundle.requests[0].request.clone();
    legacy_request.protocol_version = "1".into();
    let mut legacy_quote = bundle.agreement.agreement.quote.quote.clone();
    legacy_quote.protocol_version = "1".into();
    let request_draft = directory.join("legacy-request.json");
    let quote_draft = directory.join("legacy-quote.json");
    save_test_object(&request_draft, &legacy_request);
    save_test_object(&quote_draft, &legacy_quote);
    let attempts = [
        (
            "sign-request",
            vec![
                test_path(&request_draft),
                test_path(&trust_file),
                test_path(&vault),
                test_path(&output),
                encoding::digest(&legacy_request).unwrap(),
            ],
        ),
        (
            "sign-quote",
            vec![
                test_path(&quote_draft),
                test_path(&request_file),
                test_path(&trust_file),
                test_path(&vault),
                test_path(&output),
                encoding::digest(&legacy_quote).unwrap(),
            ],
        ),
    ];
    for (command, args) in attempts {
        let result = cli_call(command, &args, None);
        assert!(!result.status.success());
        assert!(String::from_utf8_lossy(&result.stderr).contains("VERSION:"));
        assert!(!output.exists());
        assert_eq!(
            fs::read_dir(&directory).unwrap().count(),
            4,
            "version refusal must not create a vault, guard, or signed artifact"
        );
    }
    fs::remove_dir_all(directory).unwrap();
}

fn cli_json<T: serde::de::DeserializeOwned>(
    command: &str,
    arguments: &[String],
    password: Option<&[u8]>,
) -> T {
    let result = cli_call(command, arguments, password);
    assert!(
        result.status.success(),
        "{command}: {}",
        String::from_utf8_lossy(&result.stderr)
    );
    encoding::strict_parse(&result.stdout).unwrap()
}

fn test_path(path: &std::path::Path) -> String {
    path.to_str().unwrap().into()
}

fn save_test_object<T: serde::Serialize>(path: &std::path::Path, value: &T) {
    write_immutable(path, &encoding::canonical(value).unwrap()).unwrap();
}

#[test]
fn cli_full_lifecycle_with_independent_vaults_and_portable_encrypted_records() {
    use nonverba_requests::{actions, model::*, transcript::*};
    use serde_json::Value;
    let directory = temporary("cli-full-lifecycle");
    // These are isolated synthetic identities and observations. No provider,
    // money transfer or physical performance is involved in this test.
    let passwords: [&[u8]; 3] = [
        b"local requester test password",
        b"local operator test password",
        b"local mediator test password",
    ];
    let vaults =
        ["requester", "operator", "mediator"].map(|name| directory.join(format!("{name}.vault")));
    let (mut work, mut trust, _) = common::fixture();
    for (index, role) in [Role::Requester, Role::Operator, Role::Mediator]
        .into_iter()
        .enumerate()
    {
        let public: crypto::KeyBinding = cli_json(
            "keygen",
            &[
                role.code().into(),
                format!("independent-local-{}", role.code()),
                test_path(&vaults[index]),
            ],
            Some(passwords[index]),
        );
        trust.parties[index].key = public;
    }
    assert_ne!(
        trust.parties[0].key.public_key_sec1_b64,
        trust.parties[1].key.public_key_sec1_b64
    );
    assert_ne!(
        trust.parties[1].key.public_key_sec1_b64,
        trust.parties[2].key.public_key_sec1_b64
    );
    let trust_file = directory.join("independent-trust.json");
    save_test_object(&trust_file, &trust);

    let mut request = work.requests[0].request.clone();
    request.requester = trust.parties[0].clone();
    let request_file = directory.join("request.json");
    let signed_request_file = directory.join("signed-request.json");
    save_test_object(&request_file, &request);
    let signed_request: SignedRequest = cli_json(
        "sign-request",
        &[
            test_path(&request_file),
            test_path(&trust_file),
            test_path(&vaults[0]),
            test_path(&signed_request_file),
            encoding::digest(&request).unwrap(),
        ],
        Some(passwords[0]),
    );

    let mut quote = work.agreement.agreement.quote.quote.clone();
    quote.operator = trust.parties[1].clone();
    quote.request_hash = encoding::digest(&signed_request.request).unwrap();
    quote.service_hash = encoding::digest(&signed_request.request.service).unwrap();
    quote.accepted_terms_hash = encoding::digest(&signed_request.request.terms).unwrap();
    let quote_file = directory.join("operator-quote.json");
    let signed_quote_file = directory.join("signed-quote.json");
    save_test_object(&quote_file, &quote);
    let signed_quote: SignedQuote = cli_json(
        "sign-quote",
        &[
            test_path(&quote_file),
            test_path(&signed_request_file),
            test_path(&trust_file),
            test_path(&vaults[1]),
            test_path(&signed_quote_file),
            encoding::digest(&quote).unwrap(),
        ],
        Some(passwords[1]),
    );

    work.requests = vec![signed_request];
    work.agreement.agreement.parties = trust.parties.clone();
    work.agreement.agreement.request_hash = quote.request_hash.clone();
    work.agreement.agreement.quote = signed_quote;
    work.agreement.signatures.clear();
    let root_hash = encoding::digest(&work.agreement.agreement).unwrap();
    let draft_file = directory.join("agreement-draft.json");
    save_test_object(&draft_file, &work);
    let preview = cli_call("preview", &[test_path(&draft_file)], None);
    assert!(preview.status.success());
    let preview_text = String::from_utf8(preview.stdout).unwrap();
    assert!(preview_text.contains(&root_hash));
    assert!(preview_text.contains("EXACT SIGNED TERMS AND POLICY"));
    assert!(preview_text.contains("operator-test-account"));
    for index in 0..3 {
        let signature_file = directory.join(format!("agreement-endorsement-{index}.json"));
        let signature: crypto::DetachedSignature = cli_json(
            "endorse",
            &[
                test_path(&draft_file),
                test_path(&trust_file),
                test_path(&vaults[index]),
                test_path(&signature_file),
                root_hash.clone(),
            ],
            Some(passwords[index]),
        );
        work.agreement.signatures.push(signature);
    }
    let bound_file = directory.join("bound-agreement.json");
    save_test_object(&bound_file, &work);
    let bound: BundleReport = cli_json(
        "verify",
        &[test_path(&bound_file), test_path(&trust_file)],
        None,
    );
    assert!(bound.agreement.bound && bound.ready_to_start);
    assert!(bound.obligations.is_empty());

    // The request allocation guard forbids a second Assignment even when a
    // user-controlled client is presented with an otherwise valid new draft.
    let mut second_assignment = work.clone();
    second_assignment.agreement.agreement.assignment_id =
        "second-assignment-for-same-request".into();
    second_assignment.agreement.signatures.clear();
    let conflicting_file = directory.join("conflicting-assignment.json");
    save_test_object(&conflicting_file, &second_assignment);
    let refused = cli_call(
        "endorse",
        &[
            test_path(&conflicting_file),
            test_path(&trust_file),
            test_path(&vaults[0]),
            test_path(&directory.join("never-authorized.json")),
            encoding::digest(&second_assignment.agreement.agreement).unwrap(),
        ],
        Some(passwords[0]),
    );
    assert!(!refused.status.success());
    assert!(String::from_utf8_lossy(&refused.stderr).contains("SIGNER_CONFLICT:"));
    assert!(!directory.join("never-authorized.json").exists());

    let artifact_hash = encoding::bytes_digest(common::EVIDENCE_BYTES);
    let envelope = EventEnvelope {
        protocol_version: PROTOCOL_VERSION.into(),
        deployment_domain: work.deployment_domain.clone(),
        assignment_id: work.agreement.agreement.assignment_id.clone(),
        agreement_hash: root_hash.clone(),
        author_role: "O".into(),
        key_id: trust.parties[1].key.key_id.clone(),
        key_epoch: "1".into(),
        sequence: "0".into(),
        previous_event_hash: None,
        nonce: "cli-completion-observation".into(),
        causal_references: vec![],
        claimed_creation_time: None,
        body: EventBody::CompletionClaim {
            milestone_id: "work".into(),
            manifest: EvidenceManifest {
                artifacts: vec![ArtifactRef {
                    sha256: artifact_hash.clone(),
                    byte_length: common::EVIDENCE_BYTES.len().to_string(),
                    media_type: "text/plain".into(),
                    capture_reference: None,
                }],
                description: "Synthetic CLI artifact; no physical truth assertion.".into(),
            },
        },
    };
    let envelope_hash = encoding::digest(&envelope).unwrap();
    let envelope_file = directory.join("completion-envelope.json");
    let event_file = directory.join("signed-completion.json");
    save_test_object(&envelope_file, &envelope);
    let unbound_refusal = cli_call(
        "sign-event",
        &[
            test_path(&draft_file),
            test_path(&trust_file),
            test_path(&envelope_file),
            test_path(&vaults[1]),
            test_path(&event_file),
            envelope_hash.clone(),
        ],
        None,
    );
    assert!(!unbound_refusal.status.success());
    assert!(String::from_utf8_lossy(&unbound_refusal.stderr).contains("LOCAL_UNBOUND:"));
    let signed_event: SignedEvent = cli_json(
        "sign-event",
        &[
            test_path(&bound_file),
            test_path(&trust_file),
            test_path(&envelope_file),
            test_path(&vaults[1]),
            test_path(&event_file),
            envelope_hash.clone(),
        ],
        Some(passwords[1]),
    );
    work.events.push(signed_event);
    work.attachments.push(Attachment {
        sha256: artifact_hash,
        bytes_b64: crypto::encode_base64url(common::EVIDENCE_BYTES),
    });
    let completion_bundle_file = directory.join("completion-bundle.json");
    save_test_object(&completion_bundle_file, &work);

    let mut acknowledgment = ActionProposal {
        protocol_version: PROTOCOL_VERSION.into(),
        deployment_domain: work.deployment_domain.clone(),
        assignment_id: work.agreement.agreement.assignment_id.clone(),
        agreement_hash: root_hash.clone(),
        policy_hash: work.agreement.agreement.policy_hash.clone(),
        scope_id: String::new(),
        parent_certificate_ids: vec![root_hash.clone(), envelope_hash.clone()],
        scope_version: "0".into(),
        nonce: "cli-requester-accepts".into(),
        allocations: vec![],
        cutover: None,
        action: Action::AcknowledgeCompletion {
            completion_event_hash: envelope_hash,
            milestone_id: "work".into(),
        },
    };
    acknowledgment.scope_id =
        actions::expected_scope(&acknowledgment, &work.agreement.agreement).unwrap();
    let acknowledgment_hash = encoding::digest(&acknowledgment).unwrap();
    let acknowledgment_file = directory.join("acknowledgment-proposal.json");
    let acknowledgment_signature_file = directory.join("signed-acknowledgment.json");
    save_test_object(&acknowledgment_file, &acknowledgment);
    let requester_authorization: crypto::DetachedSignature = cli_json(
        "sign-action",
        &[
            test_path(&completion_bundle_file),
            test_path(&trust_file),
            test_path(&acknowledgment_file),
            test_path(&vaults[0]),
            test_path(&acknowledgment_signature_file),
            acknowledgment_hash.clone(),
        ],
        Some(passwords[0]),
    );
    work.actions.push(ActionCertificate {
        proposal: acknowledgment,
        authorizations: vec![requester_authorization],
    });
    let accepted_file = directory.join("accepted-bundle.json");
    save_test_object(&accepted_file, &work);
    let accepted: BundleReport = cli_json(
        "verify",
        &[test_path(&accepted_file), test_path(&trust_file)],
        None,
    );
    assert_eq!(accepted.obligations[0].unresolved_balance, "10000");
    assert_eq!(accepted.obligations[0].discharged_amount, "0");

    let mut receipt = ActionProposal {
        protocol_version: PROTOCOL_VERSION.into(),
        deployment_domain: work.deployment_domain.clone(),
        assignment_id: work.agreement.agreement.assignment_id.clone(),
        agreement_hash: root_hash.clone(),
        policy_hash: work.agreement.agreement.policy_hash.clone(),
        scope_id: String::new(),
        parent_certificate_ids: vec![root_hash.clone(), acknowledgment_hash],
        scope_version: "0".into(),
        nonce: "cli-payee-test-receipt".into(),
        allocations: vec![UnitAllocation {
            obligation_id: "milestone:work".into(),
            basis_agreement_hash: root_hash.clone(),
            start: "0".into(),
            end: "10000".into(),
        }],
        cutover: None,
        action: Action::PaymentReceipt {
            payment_id: "test-payee-observation".into(),
            obligation_id: "milestone:work".into(),
            amount: common::money("10000"),
            rail_reference: "SYNTHETIC-TEST-NO-TRANSFER".into(),
        },
    };
    receipt.scope_id = actions::expected_scope(&receipt, &work.agreement.agreement).unwrap();
    let receipt_file = directory.join("receipt-proposal.json");
    let receipt_signature_file = directory.join("signed-payee-receipt.json");
    save_test_object(&receipt_file, &receipt);
    let payee_authorization: crypto::DetachedSignature = cli_json(
        "sign-action",
        &[
            test_path(&accepted_file),
            test_path(&trust_file),
            test_path(&receipt_file),
            test_path(&vaults[1]),
            test_path(&receipt_signature_file),
            encoding::digest(&receipt).unwrap(),
        ],
        Some(passwords[1]),
    );
    work.actions.push(ActionCertificate {
        proposal: receipt,
        authorizations: vec![payee_authorization],
    });
    let final_file = directory.join("receipt-bundle.json");
    save_test_object(&final_file, &work);
    let completed: BundleReport = cli_json(
        "verify",
        &[test_path(&final_file), test_path(&trust_file)],
        None,
    );
    assert_eq!(completed.obligations[0].unresolved_balance, "0");
    assert_eq!(completed.obligations[0].discharged_amount, "10000");
    assert_eq!(completed.payments.len(), 1);
    assert!(
        completed
            .history_completeness
            .to_ascii_lowercase()
            .contains("unknown")
    );

    let store = directory.join("encrypted-store");
    let storage_password = b"separate local evidence retention password";
    let imported: Value = cli_json(
        "import",
        &[
            test_path(&final_file),
            test_path(&trust_file),
            test_path(&store),
        ],
        Some(storage_password),
    );
    let snapshot = PathBuf::from(imported["snapshot_path"].as_str().unwrap());
    assert!(
        !fs::read_to_string(&snapshot)
            .unwrap()
            .contains(&crypto::encode_base64url(common::EVIDENCE_BYTES))
    );

    let mut left = work.clone();
    let mut right = work.clone();
    left.agreement.signatures.truncate(1);
    left.actions.truncate(1);
    right.agreement.signatures.remove(0);
    right.actions.remove(0);
    right.events.clear();
    let left_file = directory.join("requester-local-view.json");
    let right_file = directory.join("operator-local-view.json");
    save_test_object(&left_file, &left);
    save_test_object(&right_file, &right);
    let merged: Value = cli_json(
        "merge",
        &[
            test_path(&left_file),
            test_path(&right_file),
            test_path(&trust_file),
            test_path(&store),
        ],
        Some(storage_password),
    );
    assert_eq!(
        merged["report"]["obligations"][0]["unresolved_balance"],
        "0"
    );
    assert_eq!(merged["report"]["agreement"]["bound"], true);
    let exported_file = directory.join("explicit-recipient-export.json");
    let export = cli_call(
        "export-store",
        &[
            merged["snapshot_path"].as_str().unwrap().into(),
            test_path(&trust_file),
            test_path(&exported_file),
            root_hash,
        ],
        Some(storage_password),
    );
    assert!(
        export.status.success(),
        "{}",
        String::from_utf8_lossy(&export.stderr)
    );
    let final_report: BundleReport = cli_json(
        "verify",
        &[test_path(&exported_file), test_path(&trust_file)],
        None,
    );
    assert_eq!(
        encoding::canonical(&final_report.obligations).unwrap(),
        encoding::canonical(&completed.obligations).unwrap()
    );
    assert_eq!(final_report.payments.len(), 1);
    assert_eq!(final_report.transcript.accepted.len(), 1);
    let portable_file = directory.join("portable-exchange.json");
    let export_copy = cli_call(
        "export",
        &[test_path(&exported_file), test_path(&portable_file)],
        None,
    );
    assert!(export_copy.status.success());
    assert_eq!(
        read_bytes(&exported_file).unwrap(),
        read_bytes(&portable_file).unwrap()
    );
    fs::remove_dir_all(directory).unwrap();
}
