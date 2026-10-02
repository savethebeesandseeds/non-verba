// SPDX-License-Identifier: AGPL-3.0-only
//! Real native command boundary, synthetic signatures and explicitly mock analysis.
#[path = "../../requests/tests/common/mod.rs"]
mod common;

use nonverba_disputes::{
    binding::*, case, consent::ConsentReviewV1, pipeline::AnalysisPackageV1,
    preflight::PreflightReviewV1, runtime::AnalysisSpecificationV1,
};
use nonverba_requests::{bundle, crypto, encoding, model::*};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::Value;
use std::{
    fs,
    io::Write,
    path::PathBuf,
    process::{Command, Output, Stdio},
    sync::atomic::{AtomicU64, Ordering},
};

struct Cli {
    dir: PathBuf,
}
impl Cli {
    fn new() -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "nv-disputes-cli-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&dir).unwrap();
        Self { dir }
    }
    fn save<T: Serialize>(&self, name: &str, value: &T) {
        nonverba_requests::local::write_immutable(
            &self.dir.join(name),
            &encoding::canonical(value).unwrap(),
        )
        .unwrap();
    }
    fn read<T: DeserializeOwned>(&self, name: &str) -> T {
        encoding::strict_parse(&fs::read(self.dir.join(name)).unwrap()).unwrap()
    }
    fn output(&self, args: &[&str], input: Option<&[u8]>) -> Output {
        let mut child = Command::new(env!("CARGO_BIN_EXE_nonverba-disputes"))
            .current_dir(&self.dir)
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        if let Some(bytes) = input {
            child.stdin.as_mut().unwrap().write_all(bytes).unwrap();
        }
        drop(child.stdin.take());
        child.wait_with_output().unwrap()
    }
    fn ok(&self, args: &[&str]) -> String {
        let out = self.output(args, None);
        assert!(
            out.status.success(),
            "{args:?}\nstdout={}\nstderr={}",
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8(out.stdout).unwrap()
    }
}

#[test]
fn terminal_profiles_annex_shared_case_mock_analysis_export_replay_and_challenge() {
    let cli = Cli::new();
    let (mut base, trust, keys) = common::fixture();
    common::establish_compensation(&mut base, &keys);
    let core =
        serde_json::to_value(bundle::verify_assignment_bundle(&base, &trust).unwrap()).unwrap();
    let original_base = encoding::canonical(&base).unwrap();
    cli.save("base.json", &base);
    cli.save("trust.json", &trust);
    cli.save("request.json", &base.requests[0]);
    cli.save("quote.json", &base.agreement.agreement.quote);
    let mut allocations = balanced_allocations();
    for (allocation, points) in allocations.iter_mut().zip([80, 30, 40, 70, 30]) {
        allocation.points = points;
    }
    cli.save("r-allocations.json", &allocations);
    cli.ok(&[
        "draft-profile",
        "R",
        "request.json",
        "trust.json",
        "r.json",
        "r-allocations.json",
    ]);
    cli.ok(&[
        "draft-profile",
        "O",
        "request.json",
        "quote.json",
        "trust.json",
        "o.json",
    ]);
    cli.ok(&["validate-profile", "r.json", "trust.json"]);
    let display = cli.ok(&["review", "profile", "r.json", "trust.json", "r-review.json"]);
    assert!(display.contains("Result | 80"));
    assert!(display.contains("Zero waives no right"));
    assert!(display.contains("EXACT RETAINED REVIEW"));
    let review: ConsentReviewV1 = cli.read("r-review.json");
    assert!(display.contains(&review.review_digest().unwrap()));
    // Cancellation is an actual CLI round trip with a nonexistent vault. No
    // password is supplied; successful authentication here would be a defect.
    let cancel = cli.output(
        &[
            "authorize",
            "r-review.json",
            "trust.json",
            "absent-vault.json",
            "must-not-sign.json",
        ],
        Some(b"\n"),
    );
    assert!(!cancel.status.success());
    let error = String::from_utf8(cancel.stderr).unwrap();
    assert!(error.contains("CONSENT_CANCELLED"));
    assert!(!error.contains("Local passphrase"));
    assert!(!cli.dir.join("must-not-sign.json").exists());
    assert!(!cli.dir.join("absent-vault.json").exists());
    let wrong = cli.output(
        &[
            "authorize",
            "r-review.json",
            "trust.json",
            "absent-vault.json",
            "must-not-sign.json",
        ],
        Some(format!("{}\n", "0".repeat(64)).as_bytes()),
    );
    assert!(!wrong.status.success());
    assert!(
        String::from_utf8(wrong.stderr)
            .unwrap()
            .contains("CONSENT_DIGEST")
    );
    for (index, name) in [(0, "r"), (1, "o")] {
        let profile: DeclaredPriorsV1 = cli.read(&format!("{name}.json"));
        let signed = SignedDeclaredPriorsV1 {
            authorization: crypto::sign(
                &declared_priors_claims(&profile, &trust).unwrap(),
                &keys[index],
            )
            .unwrap(),
            profile,
        };
        cli.save(&format!("signed-{name}.json"), &signed);
        cli.ok(&[
            "verify-profile",
            &format!("signed-{name}.json"),
            "trust.json",
        ]);
    }
    cli.ok(&[
        "spec",
        "signed-r.json",
        "signed-o.json",
        "trust.json",
        "spec.json",
    ]);
    let spec: Value = cli.read("spec.json");
    assert_eq!(spec["version"], 1);
    assert_eq!(spec["runtime_status"], "MODEL_UNAVAILABLE");
    assert!(spec["gguf_sha256"].is_null());
    let help = cli.ok(&["help"]);
    for version in 2..=5 {
        let command = format!("spec-v{version}");
        let file = format!("spec-v{version}.json");
        assert!(help.contains(&format!("{command} <signed-R-profile>")));
        cli.ok(&[
            &command,
            "signed-r.json",
            "signed-o.json",
            "trust.json",
            &file,
        ]);
        let explicit: AnalysisSpecificationV1 = cli.read(&file);
        explicit.validate().unwrap();
        assert_eq!(explicit.version, version);
        assert_eq!(explicit.runtime_status, "MODEL_UNAVAILABLE");
        assert!(explicit.gguf_sha256.is_none());
        assert_eq!(
            explicit.qualitative_prompt_version,
            format!("nv-qualitative-comparison-v{version}")
        );
    }
    assert_eq!(cli.read::<Value>("spec.json"), spec);
    for (settings, review_file) in [
        ("spec.json", "preflight-v1.json"),
        ("spec-v4.json", "preflight-v4.json"),
        ("spec-v5.json", "preflight-v5.json"),
    ] {
        cli.ok(&[
            "preflight-review",
            "signed-r.json",
            "signed-o.json",
            settings,
            "trust.json",
            review_file,
        ]);
    }
    let old_review: PreflightReviewV1 = cli.read("preflight-v1.json");
    let accepted = cli.output(
        &[
            "preflight-decide",
            "preflight-v1.json",
            "trust.json",
            "O",
            "accept",
            "accepted-v1.json",
        ],
        Some(format!("{}\n", old_review.digest().unwrap()).as_bytes()),
    );
    assert!(accepted.status.success());
    for version in [4, 5] {
        let review_file = format!("preflight-v{version}.json");
        let accepted_file = format!("accepted-v{version}.json");
        let changed = cli.output(
            &[
                "check-preflight",
                &review_file,
                "accepted-v1.json",
                "base.json",
                "trust.json",
            ],
            None,
        );
        assert!(!changed.status.success());
        assert!(
            String::from_utf8(changed.stderr)
                .unwrap()
                .contains("PREFLIGHT_CHANGED")
        );
        let new_review: PreflightReviewV1 = cli.read(&review_file);
        let accepted = cli.output(
            &[
                "preflight-decide",
                &review_file,
                "trust.json",
                "O",
                "accept",
                &accepted_file,
            ],
            Some(format!("{}\n", new_review.digest().unwrap()).as_bytes()),
        );
        assert!(accepted.status.success());
        cli.ok(&[
            "check-preflight",
            &review_file,
            &accepted_file,
            "base.json",
            "trust.json",
        ]);
    }
    let agreement_hash = encoding::digest(&base.agreement.agreement).unwrap();
    cli.ok(&[
        "draft-context",
        "base.json",
        "trust.json",
        &agreement_hash,
        "signed-r.json",
        "signed-o.json",
        "spec.json",
        "context.json",
    ]);
    let display = cli.ok(&[
        "review",
        "context",
        "context.json",
        "base.json",
        "trust.json",
        "context-review.json",
    ]);
    assert!(display.contains("Prior | R points | O points"));
    assert!(display.contains("Result | 80 | 50"));
    let context: DisputeContextV1 = cli.read("context.json");
    for (index, role) in [Role::Requester, Role::Operator, Role::Mediator]
        .into_iter()
        .enumerate()
    {
        let signature = crypto::sign(
            &context_claims(&context, &base, &trust, role).unwrap(),
            &keys[index],
        )
        .unwrap();
        cli.save(
            &format!("annex-{}.json", role.code()),
            &SignedDisputeContextV1 {
                context: context.clone(),
                endorsements: vec![signature],
            },
        );
    }
    let partial = cli.ok(&[
        "attach-context",
        "annex-R.json",
        "annex-O.json",
        "base.json",
        "trust.json",
        "annex-RO.json",
    ]);
    assert!(partial.contains("INCOMPLETE"));
    assert!(partial.contains("\"base_agreement_bound\": true"));
    let complete = cli.ok(&[
        "attach-context",
        "annex-RO.json",
        "annex-M.json",
        "base.json",
        "trust.json",
        "annex.json",
    ]);
    assert!(complete.contains("\"extended_setup_complete\": true"));
    cli.ok(&["inspect-context", "base.json", "trust.json", "annex.json"]);
    cli.save("scope.json", &vec!["milestone:work"]);
    cli.ok(&[
        "draft-case",
        "base.json",
        "trust.json",
        "annex.json",
        "cli-case",
        "scope.json",
        "case-empty.json",
    ]);
    fs::write(
        cli.dir.join("original.txt"),
        "Operator's attributed statement. A signature does not prove this claim.",
    )
    .unwrap();
    cli.ok(&[
        "draft-submission",
        "case-empty.json",
        "O",
        "operator-evidence",
        "text/plain",
        "original.txt",
        "submission-body.json",
    ]);
    cli.ok(&[
        "review",
        "evidence",
        "submission-body.json",
        "base.json",
        "annex.json",
        "trust.json",
        "submission-review.json",
    ]);
    let body: case::EvidenceSubmissionBodyV1 = cli.read("submission-body.json");
    let signed = case::EvidenceSubmissionV1 {
        authorization: crypto::sign(
            &case::submission_claims(&body, &base, &trust).unwrap(),
            &keys[1],
        )
        .unwrap(),
        body,
    };
    cli.save("submission.json", &signed);
    cli.ok(&[
        "add-evidence",
        "case-empty.json",
        "submission.json",
        "original.txt",
        "case.json",
    ]);
    cli.ok(&[
        "inspect-case",
        "case.json",
        "trust.json",
        "annex.json",
        "none",
    ]);
    cli.ok(&[
        "draft-budget",
        "synthetic-compute-sponsor",
        "3",
        "65536",
        "900000",
        "8",
        "budget.json",
    ]);
    cli.ok(&[
        "package",
        "case.json",
        "trust.json",
        "annex.json",
        "budget.json",
        "package.json",
    ]);
    cli.ok(&["mock-responses", "mock.json"]);
    // Provenance must not depend on the model/test prose voluntarily saying mock.
    let script: Vec<String> = cli.read("mock.json");
    let script: Vec<String> = script
        .into_iter()
        .map(|raw| {
            let mut value: Value = serde_json::from_str(&raw).unwrap();
            value["unresolved_reasons"] =
                serde_json::json!(["Settlement policy remains unspecified."]);
            serde_json::to_string(&value).unwrap()
        })
        .collect();
    cli.save("unlabelled-script.json", &script);
    cli.ok(&[
        "run-analysis",
        "package.json",
        "trust.json",
        "diagnostic",
        "mock",
        "run.json",
        "unlabelled-script.json",
        "none",
    ]);
    let package: AnalysisPackageV1 = cli.read("run.json");
    assert_eq!(package.attempts.len(), 3);
    assert!(
        package
            .attempts
            .iter()
            .all(|a| a.financial_authority == "NONE")
    );
    let report: Value =
        serde_json::from_str(&cli.ok(&["inspect-analysis", "run.json", "trust.json"])).unwrap();
    assert_eq!(report["base_financial_projection"], core);
    assert_eq!(report["analysis_package_valid"], true);
    assert_eq!(report["attempts"][0]["execution_kind"], "MOCK");
    assert_eq!(
        report["attempts"][0]["eligible_as_real_local_analysis"],
        false
    );
    cli.ok(&["report-analysis", "run.json", "trust.json", "report.txt"]);
    let rendered = fs::read_to_string(cli.dir.join("report.txt")).unwrap();
    assert!(
        rendered.contains("SYNTHETIC MOCK — development output; not a real local-model result")
    );
    assert!(rendered.contains("Eligible as current real local analysis: false"));
    assert!(rendered.contains("ATTRIBUTED CLAIMS AND EVIDENCE"));
    assert!(rendered.contains("MODEL INTERPRETATIONS AND OPEN QUESTIONS"));
    let (_, inspection_json) = rendered
        .split_once("COMPLETE INDEPENDENT INSPECTION\n")
        .unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(inspection_json).unwrap(),
        report
    );
    // Identical bytes are deliberately idempotent; different report contents
    // must not replace the existing immutable artifact.
    cli.ok(&["report-analysis", "run.json", "trust.json", "report.txt"]);
    assert_eq!(
        fs::read_to_string(cli.dir.join("report.txt")).unwrap(),
        rendered
    );
    let conflicting_report = cli.output(
        &[
            "report-analysis",
            "package.json",
            "trust.json",
            "report.txt",
        ],
        None,
    );
    assert!(!conflicting_report.status.success());
    assert!(
        String::from_utf8(conflicting_report.stderr)
            .unwrap()
            .contains("LOCAL_IMMUTABLE")
    );
    assert_eq!(
        fs::read_to_string(cli.dir.join("report.txt")).unwrap(),
        rendered
    );
    cli.ok(&["export-analysis", "run.json", "trust.json", "export.json"]);
    let replay: Value =
        serde_json::from_str(&cli.ok(&["replay-analysis", "export.json", "trust.json"])).unwrap();
    assert_eq!(replay["base_financial_projection"], core);
    assert_eq!(replay["analysis_package_valid"], true);
    assert_eq!(replay["attempts"][0]["execution_kind"], "MOCK");
    assert_eq!(
        replay["attempts"][0]["eligible_as_real_local_analysis"],
        false
    );
    cli.ok(&[
        "import-analysis",
        "export.json",
        "trust.json",
        "received.json",
    ]);
    fs::write(
        cli.dir.join("challenge.txt"),
        "Please distinguish the attributed claim from verified physical performance.",
    )
    .unwrap();
    cli.ok(&[
        "draft-challenge",
        "received.json",
        "trust.json",
        "R",
        "challenge-1",
        "INTERPRETATION",
        "challenge.txt",
        "challenge-body.json",
    ]);
    cli.ok(&[
        "review",
        "challenge",
        "challenge-body.json",
        "base.json",
        "annex.json",
        "trust.json",
        "challenge-review.json",
    ]);
    let body: case::AnalysisChallengeBodyV1 = cli.read("challenge-body.json");
    let signed = case::AnalysisChallengeV1 {
        authorization: crypto::sign(
            &case::challenge_claims(&body, &base, &trust).unwrap(),
            &keys[0],
        )
        .unwrap(),
        body,
    };
    cli.save("challenge.json", &signed);
    cli.ok(&[
        "append-challenge",
        "received.json",
        "trust.json",
        "challenge.json",
        "challenged.json",
    ]);
    let final_report: Value =
        serde_json::from_str(&cli.ok(&["inspect-analysis", "challenged.json", "trust.json"]))
            .unwrap();
    assert_eq!(final_report["analysis_package_valid"], true);
    assert_eq!(final_report["base_financial_projection"], core);
    assert_eq!(fs::read(cli.dir.join("base.json")).unwrap(), original_base);
    assert_eq!(
        encoding::canonical(&cli.read::<AnalysisPackageV1>("challenged.json").cases[0].bundle)
            .unwrap(),
        original_base
    );
    assert!(cli.dir.join("run.json.attempts/run-intent.json").exists());
    assert_eq!(
        fs::read_dir(cli.dir.join("run.json.attempts"))
            .unwrap()
            .count(),
        4
    );
}

#[test]
fn priors_commands_preserve_catalog_declaration_and_review_bytes() {
    let cli = Cli::new();
    let (base, trust, _) = common::fixture();
    cli.save("request.json", &base.requests[0]);
    cli.save("trust.json", &trust);
    assert_eq!(cli.ok(&["catalog"]), cli.ok(&["dictionary"]));
    cli.ok(&[
        "draft-priors",
        "R",
        "request.json",
        "trust.json",
        "priors.json",
    ]);
    cli.ok(&[
        "draft-profile",
        "R",
        "request.json",
        "trust.json",
        "profile.json",
    ]);
    let current: DeclaredPriorsV1 = cli.read("priors.json");
    let earlier: PartyProfileV1 = cli.read("profile.json");
    assert_eq!(
        encoding::canonical(&current).unwrap(),
        encoding::canonical(&earlier).unwrap()
    );
    cli.ok(&["validate-priors", "priors.json", "trust.json"]);
    cli.ok(&[
        "review",
        "priors",
        "priors.json",
        "trust.json",
        "current-review.json",
    ]);
    cli.ok(&[
        "review",
        "profile",
        "profile.json",
        "trust.json",
        "earlier-review.json",
    ]);
    assert_eq!(
        fs::read(cli.dir.join("current-review.json")).unwrap(),
        fs::read(cli.dir.join("earlier-review.json")).unwrap()
    );
}
