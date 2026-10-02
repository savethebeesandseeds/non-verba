// SPDX-License-Identifier: AGPL-3.0-only
//! Adapter acceptance through the real binaries. All identities and payments are synthetic.
use nonverba_requests::{
    bundle::verify_assignment_bundle, crypto, encoding, local, model::*, transcript::EventBody,
};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::Value;
use std::{
    fs,
    io::Write,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
};
mod common;

const APPENDIX: &str = "\n=== COMPLETE CORE BUNDLEREPORT JSON ===\n";
const PASSWORDS: [&str; 3] = [
    "synthetic requester private password",
    "synthetic operator separate password",
    "synthetic mediator separate password",
];
const STORE_PASSWORD: &str = "synthetic participant retained snapshot password";

struct Workspace(PathBuf);
impl Workspace {
    fn new(label: &str) -> Self {
        assert_eq!(std::env::var("NONVERBA_CONTAINER").as_deref(), Ok("1"));
        let target = PathBuf::from(std::env::var_os("CARGO_TARGET_DIR").unwrap());
        assert!(
            target.starts_with("/opt"),
            "test files must stay in managed volumes"
        );
        let path = target.join(format!(
            "workflow-acceptance-{label}-{}",
            hex::encode(crypto::fresh_salt().unwrap())
        ));
        fs::create_dir(&path).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).unwrap();
        fs::create_dir(path.join("exchange")).unwrap();
        for role in ["R", "O", "M"] {
            let private = path.join(format!("private-{role}"));
            fs::create_dir(&private).unwrap();
            fs::set_permissions(private, fs::Permissions::from_mode(0o700)).unwrap();
        }
        Self(path)
    }

    fn file(&self, name: &str) -> PathBuf {
        self.0.join("exchange").join(name)
    }

    fn vault(&self, role: &str) -> PathBuf {
        self.0.join(format!("private-{role}/signer.vault"))
    }

    fn store(&self, name: &str) -> PathBuf {
        self.0.join("private-R").join(name)
    }
}
impl Drop for Workspace {
    fn drop(&mut self) {
        // This exact random directory was created by this test under /opt.
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn p(path: &Path) -> &str {
    path.to_str().unwrap()
}
fn read<T: DeserializeOwned>(path: &Path) -> T {
    encoding::strict_parse(&fs::read(path).unwrap()).unwrap()
}
fn save<T: Serialize>(path: &Path, value: &T) {
    local::write_immutable(path, &encoding::canonical(value).unwrap()).unwrap();
}
fn run(args: &[&str], input: &str) -> Output {
    let mut child = Command::new(env!("CARGO_BIN_EXE_nonverba-workflow"))
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut stdin = child.stdin.take().unwrap();
    stdin.write_all(input.as_bytes()).unwrap();
    drop(stdin);
    child.wait_with_output().unwrap()
}
fn ok(args: &[&str], input: &str) -> String {
    let output = run(args, input);
    assert!(
        output.status.success(),
        "command {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap()
}
fn rejected(args: &[&str], input: &str, code: &str, absent: &Path) {
    let output = run(args, input);
    assert!(!output.status.success(), "unexpected success: {args:?}");
    assert!(
        String::from_utf8_lossy(&output.stderr).contains(code),
        "wrong rejection: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        !absent.exists(),
        "a rejected authorization must write no signed output"
    );
}
fn review(kind: &str, source: &Path, output: &Path, context: Option<&Path>) -> String {
    let mut args = vec!["review", kind, p(source), p(output)];
    if let Some(context) = context {
        args.push(p(context));
    }
    let rendered = ok(&args, "");
    let retained: Value = read(output);
    let hash = retained["content_hash"].as_str().unwrap();
    assert!(rendered.contains(hash));
    assert!(rendered.contains(&serde_json::to_string_pretty(&retained["exact_content"]).unwrap()));
    if !retained["retained_context"].is_null() {
        assert!(
            rendered
                .contains(&serde_json::to_string_pretty(&retained["retained_context"]).unwrap())
        );
    }
    assert_eq!(encoding::digest(&retained["exact_content"]).unwrap(), hash);
    assert_signing_consequences(&rendered, &retained);
    hash.to_owned()
}
fn authorize(review: &Path, trust: &Path, vault: &Path, output: &Path, password: &str) {
    let record: Value = read(review);
    let hash = record["content_hash"].as_str().unwrap();
    let rendered = ok(
        &["authorize", p(review), p(trust), p(vault), p(output)],
        &format!("{hash}\n{password}\n"),
    );
    assert!(rendered.contains(hash));
    assert!(
        !rendered.contains(password),
        "private input must not enter the transcript"
    );
    assert!(output.is_file());
    assert_signing_consequences(&rendered, &record);
}
fn assert_signing_consequences(text: &str, record: &Value) {
    let object = &record["exact_content"];
    let expected = match object["action"]["type"].as_str() {
        Some("ACKNOWLEDGE_COMPLETION") => Some("REQUESTER MILESTONE ACKNOWLEDGMENT"),
        Some("PAYMENT_RECEIPT") => Some("PAYEE RECEIPT"),
        Some("BILATERAL_SETTLEMENT") => Some("SCOPED R/O SETTLEMENT"),
        _ => match object["body"]["type"].as_str() {
            Some("RECEIPT_ACKNOWLEDGMENT") => Some("MESSAGE/FILE RECEIPT ONLY"),
            Some("PAYER_STATEMENT") => Some("PAYER OBSERVATION ONLY"),
            _ => None,
        },
    };
    if let Some(expected) = expected {
        assert!(text.contains(expected), "missing consequence: {expected}");
        assert!(text.contains("SIGNING CONSEQUENCES"));
    }
}
fn assert_projection(text: &str, expected: &BundleReport) {
    let (human, json) = text.split_once(APPENDIX).expect("complete report appendix");
    let actual: Value = serde_json::from_str(json).unwrap();
    assert_eq!(actual, serde_json::to_value(expected).unwrap());
    assert!(human.contains(&format!("Agreement bound: {}", expected.agreement.bound)));
    assert!(human.contains(&format!(
        "Core ready_to_start (technical record-check flag): {}",
        expected.ready_to_start
    )));
    let readiness = if expected.ready_to_start {
        "Protocol record checks passed — operational readiness not assessed."
    } else {
        "Protocol record checks not passed — operational readiness not assessed."
    };
    assert!(human.contains(readiness));
    for section in [
        "PERFORMANCE VIEW",
        "PAYMENT OBSERVATIONS",
        "MEDIATION VIEW",
        "ASSURANCE VIEW",
        "EVIDENCE INTEGRITY VIEW",
        "TRANSCRIPT, DELIVERY AND HISTORY",
        "CONDITIONAL RIGHTS - KEEP EACH PROOF SEPARATE",
    ] {
        assert!(
            human.contains(section),
            "missing independent view: {section}"
        );
    }
    let active_section = human
        .split_once("=== ACTIVE ITEMIZED OBLIGATIONS ===\n")
        .unwrap()
        .1
        .split_once("=== CONDITIONAL RIGHTS - KEEP EACH PROOF SEPARATE ===")
        .unwrap()
        .0;
    let blocks: Vec<_> = active_section
        .split("\nActive obligation ")
        .skip(1)
        .collect();
    assert_eq!(blocks.len(), expected.obligations.len());
    for item in &expected.obligations {
        let identity = format!("Obligation: {}", serde_json::to_string(&item.id).unwrap());
        let block = blocks
            .iter()
            .find(|block| block.contains(&identity))
            .expect("itemized obligation entry");
        for (label, value) in [
            ("Discharged minor units", &item.discharged_amount),
            ("Released minor units", &item.released_amount),
            ("Credit/release overlap minor units", &item.overlap_amount),
            (
                "Outstanding recorded balance minor units",
                &item.unresolved_balance,
            ),
            ("Retained due-condition text", &item.due_conditions),
        ] {
            assert!(block.contains(&format!(
                "{label}: {}",
                serde_json::to_string(value).unwrap()
            )));
        }
        assert!(block.contains(&format!(
            "Recorded principal (minor units, currency, exponent): {}",
            serde_json::to_string(&item.amount).unwrap()
        )));
    }
    for effect in &expected.effects {
        assert!(human.contains(&effect.certificate_id));
        for reference in &effect.proof_references {
            assert!(human.contains(reference));
        }
    }
}
fn inspect(w: &Workspace, bundle_path: &Path, trust_path: &Path, name: &str) -> BundleReport {
    let bundle: AssignmentBundle = read(bundle_path);
    let trust: TrustConfiguration = read(trust_path);
    let expected = verify_assignment_bundle(&bundle, &trust).unwrap();
    let report_file = w.file(&format!("{name}.txt"));
    let text = ok(
        &["inspect", p(bundle_path), p(trust_path), p(&report_file)],
        "",
    );
    assert_eq!(fs::read_to_string(report_file).unwrap(), text);
    assert_projection(&text, &expected);
    expected
}
fn obligation<'a>(report: &'a BundleReport, id: &str) -> &'a Obligation {
    report
        .obligations
        .iter()
        .find(|item| item.id == id)
        .unwrap()
}

fn capture_public_result(
    w: &Workspace,
    bundle: &Path,
    trust: &Path,
    report_name: &str,
    label: &str,
) {
    let Some(directory) = std::env::var_os("NONVERBA_WORKFLOW_CAPTURE_DIR") else {
        return;
    };
    let directory = PathBuf::from(directory);
    assert!(directory.starts_with("/workspace/reviews"));
    assert!(
        directory
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("integration-final-vectors-")
    );
    fs::create_dir_all(&directory).unwrap();
    let text = fs::read(w.file(&format!("{report_name}.txt"))).unwrap();
    let report = std::str::from_utf8(&text)
        .unwrap()
        .split_once(APPENDIX)
        .unwrap()
        .1;
    let outputs = [
        (format!("{label}-bundle.json"), fs::read(bundle).unwrap()),
        (format!("{label}-trust.json"), fs::read(trust).unwrap()),
        (format!("{label}-report.json"), report.as_bytes().to_vec()),
        (format!("{label}-inspection.txt"), text),
    ];
    for (name, bytes) in outputs {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(directory.join(name))
            .unwrap();
        file.write_all(&bytes).unwrap();
        file.sync_all().unwrap();
    }
    // Only public synthetic exchange artifacts are exported. Private vaults,
    // passwords, signing guards and encrypted local stores stay out of captures.
}

#[test]
fn independent_vaults_complete_the_reviewed_synthetic_lifecycle() {
    let w = Workspace::new("lifecycle");
    let trust = w.file("trust.json");
    let publics = ["R", "O", "M"].map(|role| w.file(&format!("public-{role}.json")));
    for (index, role) in ["R", "O", "M"].into_iter().enumerate() {
        ok(
            &[
                "participant",
                role,
                &format!("development-{role}"),
                p(&w.vault(role)),
                p(&publics[index]),
            ],
            &format!("{}\n", PASSWORDS[index]),
        );
        let vault: local::EncryptedRecord = read(&w.vault(role));
        assert_eq!(vault.header.key_binding.unwrap().role, role);
        assert!(!w.vault(role).starts_with(w.file("")));
    }
    ok(
        &[
            "trust",
            p(&publics[0]),
            p(&publics[1]),
            p(&publics[2]),
            p(&trust),
        ],
        "",
    );
    let pinned: TrustConfiguration = read(&trust);
    for (index, binding) in pinned.parties.iter().enumerate() {
        let public: crypto::KeyBinding = read(&publics[index]);
        assert_eq!(binding.key, public);
    }
    assert_ne!(
        pinned.parties[0].key.public_key_sec1_b64,
        pinned.parties[1].key.public_key_sec1_b64
    );
    assert_ne!(
        pinned.parties[0].key.public_key_sec1_b64,
        pinned.parties[2].key.public_key_sec1_b64
    );
    assert_ne!(
        pinned.parties[1].key.public_key_sec1_b64,
        pinned.parties[2].key.public_key_sec1_b64
    );

    let request = w.file("request.json");
    let request_review = w.file("request-review.json");
    let signed_request = w.file("signed-request.json");
    ok(&["draft-request", p(&trust), p(&request)], "");
    let request_hash = review("request", &request, &request_review, None);
    let wrong_signer_output = w.file("wrong-signer.json");
    rejected(
        &[
            "authorize",
            p(&request_review),
            p(&trust),
            p(&w.vault("O")),
            p(&wrong_signer_output),
        ],
        &format!("{request_hash}\n{}\n", PASSWORDS[1]),
        "KEY_AUTHORITY",
        &wrong_signer_output,
    );
    authorize(
        &request_review,
        &trust,
        &w.vault("R"),
        &signed_request,
        PASSWORDS[0],
    );
    let authored: SignedRequest = read(&signed_request);
    assert_eq!(encoding::digest(&authored.request).unwrap(), request_hash);

    let quote = w.file("quote.json");
    let quote_review = w.file("quote-review.json");
    let signed_quote = w.file("signed-quote.json");
    ok(
        &["draft-quote", p(&signed_request), p(&trust), p(&quote)],
        "",
    );
    let quote_hash = review("quote", &quote, &quote_review, Some(&signed_request));
    authorize(
        &quote_review,
        &trust,
        &w.vault("O"),
        &signed_quote,
        PASSWORDS[1],
    );
    let offered: SignedQuote = read(&signed_quote);
    assert_eq!(encoding::digest(&offered.quote).unwrap(), quote_hash);

    let initial = w.file("agreement-unsigned.json");
    let agreement_review = w.file("agreement-review.json");
    ok(
        &[
            "draft-agreement",
            p(&signed_request),
            p(&signed_quote),
            p(&trust),
            p(&initial),
        ],
        "",
    );
    let root_hash = review("agreement", &initial, &agreement_review, None);
    let initial_bundle: AssignmentBundle = read(&initial);
    let review_before = fs::read(&agreement_review).unwrap();
    let mut edited = initial_bundle.clone();
    edited.agreement.agreement.payments.destination = "changed-after-preview".into();
    let edited_path = w.file("edited-proposal.json");
    let edited_review = w.file("edited-review.json");
    save(&edited_path, &edited);
    let new_hash = review("agreement", &edited_path, &edited_review, None);
    assert_ne!(root_hash, new_hash);
    let stale_output = w.file("stale-consent.json");
    rejected(
        &[
            "authorize",
            p(&edited_review),
            p(&trust),
            p(&w.vault("R")),
            p(&stale_output),
        ],
        &format!("{root_hash}\n{}\n", PASSWORDS[0]),
        "CONSENT_DIGEST",
        &stale_output,
    );
    let overwrite = run(
        &["review", "agreement", p(&edited_path), p(&agreement_review)],
        "",
    );
    assert!(!overwrite.status.success());
    assert_eq!(fs::read(&agreement_review).unwrap(), review_before);

    let mut current = initial;
    for (index, role) in ["R", "O", "M"].into_iter().enumerate() {
        let endorsement = w.file(&format!("endorsement-{role}.json"));
        authorize(
            &agreement_review,
            &trust,
            &w.vault(role),
            &endorsement,
            PASSWORDS[index],
        );
        let next = w.file(&format!("agreement-with-{role}.json"));
        ok(
            &[
                "attach",
                "endorsement",
                p(&current),
                p(&endorsement),
                p(&trust),
                p(&next),
            ],
            "",
        );
        current = next;
        let state = inspect(&w, &current, &trust, &format!("formation-{role}"));
        assert_eq!(state.agreement.bound, index == 2);
        assert_eq!(state.agreement.valid_signers.len(), index + 1);
        if index == 2 {
            assert!(state.ready_to_start);
        }
    }
    assert_eq!(
        encoding::digest(&read::<AssignmentBundle>(&current).agreement.agreement).unwrap(),
        root_hash
    );

    let attachment = w.file("attachment.json");
    let with_attachment = w.file("with-attachment.json");
    ok(&["demo-attachment", p(&attachment)], "");
    ok(
        &[
            "attach",
            "attachment",
            p(&current),
            p(&attachment),
            p(&trust),
            p(&with_attachment),
        ],
        "",
    );
    current = with_attachment;
    for (kind, role, password) in [
        ("completion", "O", PASSWORDS[1]),
        ("payer-observation", "R", PASSWORDS[0]),
    ] {
        if kind == "payer-observation" {
            let completed: AssignmentBundle = read(&current);
            let completion = completed
                .events
                .iter()
                .find(|event| matches!(&event.envelope.body, EventBody::CompletionClaim { .. }))
                .unwrap();
            let completion_hash = encoding::digest(&completion.envelope).unwrap();
            current = apply_cli_action(
                &w,
                "ack",
                "R",
                PASSWORDS[0],
                &current,
                &trust,
                &[&completion_hash],
            );
            let acknowledged = inspect(&w, &current, &trust, "acknowledged");
            assert_eq!(
                obligation(&acknowledged, "milestone:work").unresolved_balance,
                "10000"
            );
        }
        let envelope = w.file(&format!("{kind}.json"));
        let retained = w.file(&format!("{kind}-review.json"));
        let signed = w.file(&format!("{kind}-signed.json"));
        let next = w.file(&format!("after-{kind}.json"));
        ok(
            &["draft-event", kind, p(&current), p(&trust), p(&envelope)],
            "",
        );
        review("event", &envelope, &retained, Some(&current));
        authorize(&retained, &trust, &w.vault(role), &signed, password);
        ok(
            &[
                "attach",
                "event",
                p(&current),
                p(&signed),
                p(&trust),
                p(&next),
            ],
            "",
        );
        current = next;
    }
    let observed = inspect(&w, &current, &trust, "observed-not-discharged");
    assert_eq!(
        obligation(&observed, "milestone:work").discharged_amount,
        "0"
    );
    assert_eq!(
        obligation(&observed, "milestone:work").unresolved_balance,
        "10000"
    );
    current = apply_cli_action(
        &w,
        "receipt",
        "O",
        PASSWORDS[1],
        &current,
        &trust,
        &["milestone:work", "10000"],
    );
    let paid = inspect(&w, &current, &trust, "payee-receipted");
    assert_eq!(
        obligation(&paid, "milestone:work").discharged_amount,
        "10000"
    );
    assert_eq!(obligation(&paid, "milestone:work").unresolved_balance, "0");
    assert!(paid.transcript.completeness_unknown);
    assert!(
        paid.payments
            .iter()
            .any(|item| item.reference.contains("SYNTHETIC"))
    );

    let bundle: AssignmentBundle = read(&current);
    let original_bytes = fs::read(&current).unwrap();
    let store = w.store("retained");
    let text = ok(
        &["retain", p(&current), p(&trust), p(&store)],
        &format!("{STORE_PASSWORD}\n"),
    );
    assert_projection(&text, &paid);
    let snapshot = local::encrypted_snapshot_path(&bundle, &store).unwrap();
    let ciphertext = fs::read_to_string(&snapshot).unwrap();
    assert!(!ciphertext.contains(&bundle.attachments[0].bytes_b64));
    let exported = w.file("exported.json");
    ok(
        &["export", p(&snapshot), p(&trust), p(&exported), &root_hash],
        &format!("{STORE_PASSWORD}\n"),
    );
    assert_eq!(fs::read(&current).unwrap(), original_bytes);
    let received: AssignmentBundle = read(&exported);
    assert_eq!(
        encoding::digest(&received).unwrap(),
        encoding::digest(&bundle).unwrap()
    );
    let independent = Command::new(env!("CARGO_BIN_EXE_nonverba-assignment"))
        .args(["verify", p(&exported), p(&trust)])
        .output()
        .unwrap();
    assert!(independent.status.success());
    assert_eq!(
        serde_json::from_slice::<Value>(&independent.stdout).unwrap(),
        serde_json::to_value(&paid).unwrap()
    );
    inspect(&w, &exported, &trust, "independent-reinspection");
    capture_public_result(
        &w,
        &exported,
        &trust,
        "independent-reinspection",
        "happy-lifecycle",
    );
    for entry in fs::read_dir(w.file("")).unwrap() {
        assert_ne!(
            entry.unwrap().path().extension().and_then(|v| v.to_str()),
            Some("vault")
        );
    }
}

fn apply_cli_action(
    w: &Workspace,
    kind: &str,
    role: &str,
    password: &str,
    current: &Path,
    trust: &Path,
    target: &[&str],
) -> PathBuf {
    let proposal = w.file(&format!("{kind}-proposal.json"));
    let retained = w.file(&format!("{kind}-review.json"));
    let signature = w.file(&format!("{kind}-signature.json"));
    let next = w.file(&format!("after-{kind}.json"));
    let mut args = vec!["draft-action", kind, p(current), p(trust), p(&proposal)];
    args.extend_from_slice(target);
    ok(&args, "");
    review("action", &proposal, &retained, Some(current));
    authorize(&retained, trust, &w.vault(role), &signature, password);
    ok(
        &[
            "attach",
            "action",
            p(current),
            p(&signature),
            p(trust),
            p(&next),
            p(&proposal),
        ],
        "",
    );
    next
}

fn late_fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/nv2-01")
        .join(name)
}

fn cancelled_preview(
    w: &Workspace,
    name: &str,
    kind: &str,
    object: &impl Serialize,
    bundle: &AssignmentBundle,
    trust: &TrustConfiguration,
) -> String {
    let source = w.file(&format!("{name}-object.json"));
    let context = w.file(&format!("{name}-context.json"));
    let trust_path = w.file(&format!("{name}-trust.json"));
    let retained = w.file(&format!("{name}-review.json"));
    let absent = w.file(&format!("{name}-unsigned.json"));
    save(&source, object);
    save(&context, bundle);
    save(&trust_path, trust);
    review(kind, &source, &retained, Some(&context));
    let record: Value = read(&retained);
    let output = run(
        &[
            "authorize",
            p(&retained),
            p(&trust_path),
            p(&w.vault("R")),
            p(&absent),
        ],
        "\n",
    );
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("CONSENT_CANCELLED"));
    assert!(!absent.exists());
    assert!(
        !w.vault("R").exists(),
        "preview never needs an unlocked vault"
    );
    let text = String::from_utf8(output.stdout).unwrap();
    assert_signing_consequences(&text, &record);
    assert!(text.contains(record["content_hash"].as_str().unwrap()));
    if let Some(directory) = std::env::var_os("NONVERBA_WORKFLOW_CAPTURE_DIR") {
        let directory = PathBuf::from(directory);
        assert!(directory.starts_with("/workspace/reviews"));
        assert!(
            directory
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("integration-final-vectors-")
        );
        fs::create_dir_all(&directory).unwrap();
        local::write_immutable(
            &directory.join(format!("consent-{name}.txt")),
            text.as_bytes(),
        )
        .unwrap();
    }
    text
}

#[test]
fn consent_display_keeps_message_acknowledgment_and_overlapping_receipts_distinct() {
    let w = Workspace::new("consent");
    let (mut bundle, trust, keys) = common::fixture();
    let completion = common::completion(&mut bundle, &keys);
    // Message delivery and milestone acceptance have different supported effects.
    let delivery = common::event(
        &bundle,
        &keys,
        Role::Requester,
        0,
        None,
        vec![completion.clone()],
        EventBody::ReceiptAcknowledgment {
            event_hash: completion.clone(),
        },
    );
    let delivery_text =
        cancelled_preview(&w, "message", "event", &delivery.envelope, &bundle, &trust);
    assert!(delivery_text.contains("MESSAGE/FILE RECEIPT ONLY"));
    assert!(!delivery_text.contains("REQUESTER MILESTONE ACKNOWLEDGMENT"));
    assert!(
        verify_assignment_bundle(&bundle, &trust)
            .unwrap()
            .obligations
            .is_empty()
    );

    let ack = common::sign_action(
        &bundle,
        &keys,
        Action::AcknowledgeCompletion {
            completion_event_hash: completion.clone(),
            milestone_id: "work".into(),
        },
        &[Role::Requester],
        std::slice::from_ref(&completion),
        "an2-ack",
    );
    // Missing bytes do not manufacture a claim that the evidence was examined.
    bundle.attachments.clear();
    let ack_text = cancelled_preview(&w, "milestone", "action", &ack.proposal, &bundle, &trust);
    assert!(ack_text.contains("EVIDENCE AVAILABILITY AND INTEGRITY"));
    assert!(ack_text.contains("10000") && ack_text.contains("EUR"));
    assert!(ack_text.contains(&ack.proposal.agreement_hash));
    bundle.actions.push(ack.clone());
    let duplicate = cancelled_preview(
        &w,
        "duplicate-milestone",
        "action",
        &ack.proposal,
        &bundle,
        &trust,
    );
    assert!(duplicate.contains("EXISTING VERIFIED OBLIGATION"));
    let entitlement = encoding::digest(&ack.proposal).unwrap();

    let first = common::sign_action(
        &bundle,
        &keys,
        Action::PaymentReceipt {
            payment_id: "an2-first".into(),
            obligation_id: "milestone:work".into(),
            amount: common::money("7000"),
            rail_reference: "Synthetic receipt; no funds moved".into(),
        },
        &[Role::Operator],
        std::slice::from_ref(&entitlement),
        "an2-first",
    );
    let first_id = encoding::digest(&first.proposal).unwrap();
    bundle.actions.push(first);
    let mut overlapping = common::sign_action(
        &bundle,
        &keys,
        Action::PaymentReceipt {
            payment_id: "an2-overlap".into(),
            obligation_id: "milestone:work".into(),
            amount: common::money("4000"),
            rail_reference: "Synthetic overlapping receipt with unallocated excess".into(),
        },
        &[Role::Operator],
        &[entitlement, first_id],
        "an2-overlap",
    );
    overlapping.proposal.allocations = vec![UnitAllocation {
        obligation_id: "milestone:work".into(),
        basis_agreement_hash: encoding::digest(&bundle.agreement.agreement).unwrap(),
        start: "5000".into(),
        end: "8000".into(),
    }];
    common::resign_action_for(
        &bundle.agreement.agreement,
        &keys,
        &mut overlapping,
        &[Role::Operator],
    );
    let receipt_text = cancelled_preview(
        &w,
        "overlapping-receipt",
        "action",
        &overlapping.proposal,
        &bundle,
        &trust,
    );
    for value in ["4000", "5000", "8000", "3000", "1000"] {
        assert!(
            receipt_text.contains(value),
            "missing exact receipt distinction: {value}"
        );
    }
    assert!(receipt_text.contains("overlap"));
    bundle.actions.push(overlapping);
    let actual = verify_assignment_bundle(&bundle, &trust).unwrap();
    let debt = obligation(&actual, "milestone:work");
    assert_eq!(debt.discharged_amount, "8000");
    assert_eq!(debt.unresolved_balance, "2000");
    assert_eq!(debt.credit_grants.len(), 2);
}

#[test]
fn disputed_and_scoped_fixture_views_preserve_every_core_distinction() {
    let w = Workspace::new("projections");
    let late: AssignmentBundle = read(&late_fixture("late-context-extension.json"));
    let late_trust: TrustConfiguration = read(&late_fixture("trust.json"));
    let (mut partial, trust, _) = common::fixture();
    partial.agreement.signatures.truncate(2);

    let (mut physical, physical_trust, keys) = common::artifact_fixture();
    let completion = common::completion(&mut physical, &keys);
    let rule = common::sign_action(
        &physical,
        &keys,
        Action::InvokeArtifactRule {
            rule_id: "exact-artifact".into(),
            completion_event_hash: completion.clone(),
        },
        &[Role::Operator],
        std::slice::from_ref(&completion),
        "adapter-artifact-rule",
    );
    physical.actions.push(rule);
    let rejection = common::event(
        &physical,
        &keys,
        Role::Requester,
        0,
        None,
        vec![completion.clone()],
        EventBody::RejectionClaim {
            completion_hash: completion,
            reason: "Physical quality remains disputed; exact bytes do not prove physical truth."
                .into(),
        },
    );
    physical.events.push(rejection);

    let (mut settled, settled_trust, keys) = common::service_fixture();
    let entitlement = common::establish_compensation(&mut settled, &keys);
    let activation = common::sign_action(
        &settled,
        &keys,
        Action::ActivateProtectionService {
            commitment_id: "evidence-assistance".into(),
        },
        &[Role::Requester, Role::Operator, Role::Mediator],
        &[],
        "adapter-activate",
    );
    settled.actions.push(activation);
    let settlement = common::sign_action(
        &settled,
        &keys,
        Action::BilateralSettlement {
            settlement_id: "adapter-scoped-release".into(),
            releases: vec![BalanceRelease {
                obligation_id: "milestone:work".into(),
                amount: common::money("2500"),
            }],
            reservation_of_other_rights: "Separate M fee and all other rights remain unchanged."
                .into(),
        },
        &[Role::Requester, Role::Operator],
        &[entitlement],
        "adapter-settlement",
    );
    settled.actions.push(settlement);

    let (mut reversed, reversed_trust, keys) = common::fixture();
    let entitlement = common::establish_compensation(&mut reversed, &keys);
    let mut receipt_ids = vec![];
    for (id, amount) in [("first", "7000"), ("second", "3000")] {
        let parents: Vec<_> = std::iter::once(entitlement.clone())
            .chain(receipt_ids.iter().cloned())
            .collect();
        let receipt = common::sign_action(
            &reversed,
            &keys,
            Action::PaymentReceipt {
                payment_id: format!("adapter-{id}"),
                obligation_id: "milestone:work".into(),
                amount: common::money(amount),
                rail_reference: "SYNTHETIC TEST PAYEE RECEIPT - no funds moved".into(),
            },
            &[Role::Operator],
            &parents,
            &format!("adapter-receipt-{id}"),
        );
        receipt_ids.push(encoding::digest(&receipt.proposal).unwrap());
        reversed.actions.push(receipt);
    }
    let reversal = common::sign_action(
        &reversed,
        &keys,
        Action::ReconcileReversal {
            payment_certificate_id: receipt_ids[0].clone(),
            amount: common::money("2000"),
            reason: "Explicit synthetic reversal of only the first grant.".into(),
        },
        &[Role::Requester, Role::Operator, Role::Mediator],
        &[entitlement, receipt_ids[0].clone()],
        "adapter-targeted-reversal",
    );
    reversed.actions.insert(0, reversal);

    for (name, bundle, trust) in [
        ("late-context", late, late_trust),
        ("partial", partial, trust),
        ("physical", physical, physical_trust),
        ("settlement", settled, settled_trust),
        ("reversal", reversed, reversed_trust),
    ] {
        let bundle_path = w.file(&format!("{name}.json"));
        let trust_path = w.file(&format!("{name}-trust.json"));
        save(&bundle_path, &bundle);
        save(&trust_path, &trust);
        let before = fs::read(&bundle_path).unwrap();
        let report = inspect(&w, &bundle_path, &trust_path, &format!("{name}-report"));
        match name {
            "late-context" => {
                assert!(!report.ready_to_start);
                assert_eq!(report.financial_projection, "PARTIAL_UNRESOLVED_V2");
                assert_eq!(
                    obligation(&report, "protection:assistance-fee").unresolved_balance,
                    "500"
                );
                assert_eq!(
                    report
                        .action_status
                        .values()
                        .filter(|s| *s == "CONFLICTED")
                        .count(),
                    2
                );
                assert_eq!(report.unresolved_rights.len(), 2);
                for right in &report.unresolved_rights {
                    assert_eq!(right.obligations[0].amount.minor_units, "1500");
                }
                let text = fs::read_to_string(w.file("late-context-report.txt")).unwrap();
                let human = text.split_once(APPENDIX).unwrap().0;
                assert!(human.contains("NOT ADDITIVE"));
                assert!(
                    human.contains("Conditional proof 1") && human.contains("Conditional proof 2")
                );
                assert!(!human.contains("\"3000\""));
            }
            "partial" => {
                assert!(!report.agreement.bound);
                assert_eq!(report.agreement.valid_signers.len(), 2);
                assert!(!report.ready_to_start);
            }
            "physical" => {
                assert!(!report.unresolved_claims.is_empty());
                assert!(report.ready_to_start);
                assert_eq!(report.performance, "DISPUTED");
                assert_eq!(
                    obligation(&report, "milestone:work").unresolved_balance,
                    "10000"
                );
            }
            "settlement" => {
                assert_eq!(
                    obligation(&report, "milestone:work").released_amount,
                    "2500"
                );
                assert_eq!(
                    obligation(&report, "milestone:work").unresolved_balance,
                    "7500"
                );
                assert_eq!(
                    obligation(&report, "protection:assistance-fee").unresolved_balance,
                    "500"
                );
            }
            "reversal" => {
                let item = obligation(&report, "milestone:work");
                assert_eq!(item.discharged_amount, "8000");
                assert_eq!(item.unresolved_balance, "2000");
                let untouched = item
                    .credit_grants
                    .iter()
                    .find(|g| g.certificate_id == receipt_ids[1])
                    .unwrap();
                assert!(untouched.revoked.is_empty());
                assert_eq!(
                    item.credit_grants
                        .iter()
                        .filter(|g| !g.revoked.is_empty())
                        .count(),
                    1
                );
            }
            _ => unreachable!(),
        }
        let exchanged = w.file(&format!("{name}-exchange.json"));
        let text = ok(
            &["exchange", p(&bundle_path), p(&trust_path), p(&exchanged)],
            "",
        );
        assert_projection(&text, &report);
        assert_eq!(
            encoding::digest(&read::<AssignmentBundle>(&exchanged)).unwrap(),
            encoding::digest(&bundle).unwrap()
        );
        assert_eq!(fs::read(&bundle_path).unwrap(), before);
        capture_public_result(
            &w,
            &bundle_path,
            &trust_path,
            &format!("{name}-report"),
            name,
        );
    }
}

#[test]
fn reordered_duplicate_exchange_and_encrypted_merge_preserve_contested_records() {
    let w = Workspace::new("merge");
    let original_prefix = fs::read(late_fixture("partial-authorization-prefix.json")).unwrap();
    let original_extension = fs::read(late_fixture("late-context-extension.json")).unwrap();
    let prefix: AssignmentBundle = encoding::strict_parse(&original_prefix).unwrap();
    let mut extension: AssignmentBundle = encoding::strict_parse(&original_extension).unwrap();
    extension.actions.reverse();
    extension.events.reverse();
    extension.actions.extend(extension.actions.clone());
    extension.events.extend(extension.events.clone());
    let left = w.file("prefix.json");
    let right = w.file("reordered-duplicates.json");
    let trust = w.file("trust.json");
    save(&left, &prefix);
    save(&right, &extension);
    save(
        &trust,
        &read::<TrustConfiguration>(&late_fixture("trust.json")),
    );
    let combined = local::merge_bundles(&prefix, &extension).unwrap();
    let expected = verify_assignment_bundle(&combined, &read(&trust)).unwrap();
    let mut exported_hashes = vec![];
    for (label, a, b) in [("forward", &left, &right), ("reverse", &right, &left)] {
        let store = w.store(label);
        let text = ok(
            &["merge", p(a), p(b), p(&trust), p(&store)],
            &format!("{STORE_PASSWORD}\n"),
        );
        assert_projection(&text, &expected);
        let snapshot = local::encrypted_snapshot_path(&combined, &store).unwrap();
        let exported = w.file(&format!("merged-{label}.json"));
        let root = encoding::digest(&combined.agreement.agreement).unwrap();
        ok(
            &["export", p(&snapshot), p(&trust), p(&exported), &root],
            &format!("{STORE_PASSWORD}\n"),
        );
        let received: AssignmentBundle = read(&exported);
        exported_hashes.push(encoding::digest(&received).unwrap());
        assert_eq!(
            encoding::digest(&received).unwrap(),
            encoding::digest(&combined).unwrap()
        );
        let report = inspect(&w, &exported, &trust, &format!("merged-{label}-report"));
        assert_eq!(
            obligation(&report, "protection:assistance-fee").unresolved_balance,
            "500"
        );
        assert_eq!(
            report
                .action_status
                .values()
                .filter(|s| *s == "CONFLICTED")
                .count(),
            2
        );
        assert_eq!(report.unresolved_rights.len(), 2);
        assert!(!report.ready_to_start);
    }
    assert_eq!(exported_hashes[0], exported_hashes[1]);
    assert_eq!(
        fs::read(late_fixture("partial-authorization-prefix.json")).unwrap(),
        original_prefix
    );
    assert_eq!(
        fs::read(late_fixture("late-context-extension.json")).unwrap(),
        original_extension
    );
}
