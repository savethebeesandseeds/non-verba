// SPDX-License-Identifier: AGPL-3.0-only
//! Local case and analysis commands. None opens a vault or creates a core Action.
use nonverba_disputes::{
    binding,
    case::{self, *},
    pipeline::{self, *},
    runtime,
};
use nonverba_requests::{
    crypto, encoding, local,
    model::{AssignmentBundle, Role, TrustConfiguration},
};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use std::{
    fs,
    io::Read,
    path::Path,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

const HELP: &str = r#"Case and local analysis commands (all output paths must be new):
  compare-profiles <signed-R.json> <signed-O.json> <trust.json>
  draft-case <bundle.json> <trust.json> <annex.json|none> <case-id> <scope.json> <new-case.json>
  inspect-case <case.json> <trust.json> <annex.json|none> <previous-case.json|none>
  draft-budget <sponsor> <runs> <tokens> <milliseconds> <evidence-rounds> <new-budget.json>
  draft-submission <case.json> <R|O|M> <id> <media-type> <original-file> <new-body.json>
  add-evidence <case.json> <signed-submission.json> <original-file> <new-case.json>
  package <case.json> <trust.json> <annex.json> <budget.json> <new-package.json>
  revise-case <package.json> <trust.json> <updated-bundle.json> <new-case.json>
  append-case <package.json> <trust.json> <revised-case.json> <new-package.json>
  draft-challenge <package.json> <trust.json> <R|O|M> <id> <INPUT|ATTRIBUTION|PROCEDURE|INTERPRETATION|RUNTIME_SPECIFICATION> <text-file> <new-body.json> [attempt-hash]
  append-challenge <package.json> <trust.json> <signed-challenge.json> <new-package.json>
  mock-responses <new-script.json>
  run-analysis <package.json> <trust.json> <single|diagnostic> <unavailable|mock|local> <new-package.json> <script-or-admin-config.json|none> <cancel-file|none>
  inspect-analysis <package.json> <independent-trust.json>
  report-analysis <package.json> <independent-trust.json> <new-report.txt>
  export-analysis <package.json> <independent-trust.json> <new-export.json>
  replay-analysis <export.json> <independent-trust.json>
  import-analysis <export.json> <independent-trust.json> <new-package.json>

Use the signing commands for evidence/challenge authorship before appending.
Drafts are editable; published revisions and exports use new immutable files.
A later revision keeps old attempts, derives their staleness and consumes another
evidence round. An answer is a signed claim added as evidence; silence is not fault.
The fixed diagnostic schedule retains three seeds including failures, with no retry
until a preferred result. The output's sibling .attempts directory journals completed
attempts and the run intent. An interrupted incomplete journal is not a valid export.
Create the named cancel file to cancel; retained late responses grant no authority.
Mock scripts are synthetic. Real inference requires explicit administrator config,
matching artifacts and a running restricted local server; see RUNTIME.md.
Exports contain plaintext shared evidence. Independently retained trust is required.
No command here pays, awards, releases, reverses, settles or closes a dispute.
"#;

fn read<T: DeserializeOwned>(path: &str) -> Result<T, String> {
    let mut file = fs::File::open(path).map_err(|e| format!("READ: {e}"))?;
    let mut bytes = Vec::new();
    file.by_ref()
        .take(encoding::MAX_JSON_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > encoding::MAX_JSON_BYTES {
        return Err("INPUT_SIZE: maximum 4 MiB".into());
    }
    encoding::strict_parse(&bytes)
}
fn save<T: Serialize>(path: &str, value: &T) -> Result<(), String> {
    local::write_immutable(Path::new(path), &encoding::canonical(value)?)
}
fn safe(text: &str) -> String {
    text.chars()
        .map(|c| {
            if ('\u{0080}'..='\u{009f}').contains(&c)
                || matches!(c,'\u{200e}'|'\u{200f}'|'\u{2028}'..='\u{202e}'|'\u{2066}'..='\u{2069}')
            {
                format!("\\u{:04x}", c as u32)
            } else {
                c.to_string()
            }
        })
        .collect()
}
fn print<T: Serialize>(value: &T) -> Result<(), String> {
    println!(
        "{}",
        safe(&serde_json::to_string_pretty(value).map_err(|e| e.to_string())?)
    );
    Ok(())
}
fn role(code: &str) -> Result<Role, String> {
    match code {
        "R" => Ok(Role::Requester),
        "O" => Ok(Role::Operator),
        "M" => Ok(Role::Mediator),
        _ => Err("ROLE: use R/O/M".into()),
    }
}
fn annex(path: &str) -> Result<Option<binding::SignedDisputeContextV1>, String> {
    if path == "none" {
        Ok(None)
    } else {
        Ok(Some(read(path)?))
    }
}
fn verified_package(path: &str, trust: &TrustConfiguration) -> Result<AnalysisPackageV1, String> {
    let p = read(path)?;
    let r = pipeline::inspect_package(&p, trust)?;
    if !r.analysis_package_valid {
        return Err(format!("PACKAGE_INVALID: {:?}", r.diagnostics));
    }
    Ok(p)
}
fn bounded_file(path: &str, limit: usize) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    fs::File::open(path)
        .map_err(|e| e.to_string())?
        .take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > limit {
        return Err("INPUT_SIZE".into());
    }
    Ok(bytes)
}

pub fn dispatch(args: &[String]) -> Result<bool, String> {
    let Some(command) = args.first().map(String::as_str) else {
        return Ok(false);
    };
    let a = &args[1..];
    match (command, a.len()) {
        ("guide-data", 0) => print_help(),
        ("compare-profiles", 3) => {
            let r: binding::SignedDeclaredPriorsV1 = read(&a[0])?;
            let o: binding::SignedDeclaredPriorsV1 = read(&a[1])?;
            let trust = read(&a[2])?;
            binding::verify_declared_priors(&r, &trust)?;
            binding::verify_declared_priors(&o, &trust)?;
            if r.profile.author.role != Role::Requester || o.profile.author.role != Role::Operator {
                return Err("PROFILE_ROLES".into());
            }
            if encoding::digest(binding::declared_priors_request(&r.profile))?
                != encoding::digest(binding::declared_priors_request(&o.profile))?
            {
                return Err("PROFILE_REQUEST_MISMATCH".into());
            }
            let rows:Vec<_>=binding::priors_catalog().dimensions.iter().map(|d|json!({"dimension":d.id,"requester_points":r.profile.allocations.iter().find(|p|p.dimension_id==d.id).map(|p|p.points),"operator_points":o.profile.allocations.iter().find(|p|p.dimension_id==d.id).map(|p|p.points)})).collect();
            print(
                &json!({"rows":rows,"settlement_policy_status":"UNSPECIFIED","note":"Separate 250-point priority budgets. No average, payout percentage, honesty score or waiver."}),
            )?;
        }
        ("draft-case", 6) => {
            let trust = read(&a[1])?;
            let annex = annex(&a[2])?;
            let case =
                case::prepare_case(read(&a[0])?, &trust, annex.as_ref(), &a[3], read(&a[4])?)?;
            save(&a[5], &case)?;
        }
        ("inspect-case", 4) => {
            let case = read(&a[0])?;
            let trust = read(&a[1])?;
            let annex = annex(&a[2])?;
            let previous: Option<DisputeCaseV1> = if a[3] == "none" {
                None
            } else {
                Some(read(&a[3])?)
            };
            print(&case::inspect_case(
                &case,
                &trust,
                annex.as_ref(),
                previous.as_ref(),
            )?)?;
        }
        ("draft-budget", 6) => {
            let budget = ComputeBudget {
                sponsor: a[0].clone(),
                maximum_runs: a[1].parse().map_err(|_| "RUNS")?,
                maximum_tokens: a[2].parse().map_err(|_| "TOKENS")?,
                maximum_elapsed_ms: a[3].parse().map_err(|_| "MILLISECONDS")?,
                maximum_evidence_rounds: a[4].parse().map_err(|_| "ROUNDS")?,
            };
            budget.validate()?;
            save(&a[5], &budget)?;
        }
        ("draft-submission", 6) => {
            let case: DisputeCaseV1 = read(&a[0])?;
            let bytes = bounded_file(&a[4], MAX_EVIDENCE_BYTES as usize)?;
            encoding::validate_id(&a[2])?;
            let body = EvidenceSubmissionBodyV1 {
                version: "1".into(),
                case_id: case.case_id,
                submission_id: a[2].clone(),
                author_role: role(&a[1])?,
                agreement_hash: case.current_agreement_hash,
                context_hash: case.context_hash.ok_or("ANNEX_REQUIRED")?,
                content_sha256: encoding::bytes_digest(&bytes),
                byte_length: bytes.len() as u64,
                media_type: a[3].clone(),
                statement_kind: StatementKindV1::Claim,
                party_offer: None,
            };
            save(&a[5], &body)?;
        }
        ("add-evidence", 4) => {
            let mut case: DisputeCaseV1 = read(&a[0])?;
            let signed: EvidenceSubmissionV1 = read(&a[1])?;
            let bytes = bounded_file(&a[2], MAX_EVIDENCE_BYTES as usize)?;
            if signed.body.case_id != case.case_id
                || signed.body.content_sha256 != encoding::bytes_digest(&bytes)
                || signed.body.byte_length != bytes.len() as u64
            {
                return Err("EVIDENCE_SOURCE_MISMATCH".into());
            }
            let item = EvidenceItemV1 {
                id: signed.body.submission_id.clone(),
                media_type: signed.body.media_type.clone(),
                content_sha256: signed.body.content_sha256.clone(),
                byte_length: signed.body.byte_length,
                availability: EvidenceAvailabilityV1::Accessible {
                    bytes_b64: crypto::encode_base64url(&bytes),
                },
                origin: EvidenceOriginV1::Submission {
                    signed: Box::new(signed),
                },
                extractions: vec![],
                submitted_sensor_appraisal: None,
            };
            case.evidence.push(item);
            save(&a[3], &case)?;
        }
        ("package", 5) => {
            let package =
                pipeline::new_package(read(&a[0])?, read(&a[1])?, read(&a[2])?, read(&a[3])?)?;
            save(&a[4], &package)?;
        }
        ("revise-case", 4) => {
            let trust = read(&a[1])?;
            let package = verified_package(&a[0], &trust)?;
            let previous = package.cases.last().ok_or("CASE_MISSING")?;
            let bundle: AssignmentBundle = read(&a[2])?;
            let mut next = case::prepare_case(
                bundle,
                &trust,
                Some(&package.context),
                &previous.case_id,
                previous.scope.clone(),
            )?;
            next.revision = previous
                .revision
                .checked_add(1)
                .ok_or("REVISION_OVERFLOW")?;
            next.parent_case_hash = Some(encoding::digest(previous)?);
            next.evidence = previous.evidence.clone();
            next.access = previous.access.clone();
            next.lifecycle = CaseLifecycleV1::UnderReview;
            save(&a[3], &next)?;
        }
        ("append-case", 4) => {
            let trust = read(&a[1])?;
            let mut package = verified_package(&a[0], &trust)?;
            pipeline::append_case(&mut package, read(&a[2])?)?;
            save(&a[3], &package)?;
        }
        ("draft-challenge", 7 | 8) => {
            let trust = read(&a[1])?;
            let package = verified_package(&a[0], &trust)?;
            let case = package.cases.last().ok_or("CASE_MISSING")?;
            let kind = serde_json::from_value(Value::String(a[4].clone()))
                .map_err(|e| format!("CHALLENGE_KIND: {e}"))?;
            let text = String::from_utf8(bounded_file(&a[5], MAX_TEXT_BYTES)?)
                .map_err(|_| "CHALLENGE_TEXT_UTF8")?;
            encoding::validate_id(&a[3])?;
            let body = AnalysisChallengeBodyV1 {
                version: "1".into(),
                challenge_id: a[3].clone(),
                case_hash: encoding::digest(case)?,
                attempt_hash: a.get(7).cloned(),
                author_role: role(&a[2])?,
                agreement_hash: case.current_agreement_hash.clone(),
                context_hash: case.context_hash.clone().ok_or("ANNEX_REQUIRED")?,
                kind,
                references: vec!["agreement".into()],
                text,
                previous_challenge_hash: package
                    .challenges
                    .last()
                    .map(encoding::digest)
                    .transpose()?,
            };
            save(&a[6], &body)?;
        }
        ("append-challenge", 4) => {
            let trust = read(&a[1])?;
            let mut package = verified_package(&a[0], &trust)?;
            pipeline::append_challenge(&mut package, read(&a[2])?)?;
            save(&a[3], &package)?;
        }
        ("mock-responses", 1) => {
            let first = json!({"issues":[],"questions":[],"prior_comparisons":[],"alternatives":[],"unresolved_reasons":["SYNTHETIC MOCK: no real model or factual determination."]});
            let mut second = first.clone();
            second["prior_comparisons"]=json!(["result","effort","reliance","responsibility","remedy"].map(|d|json!({"dimension_id":d,"requester_emphasis":"Declared priority only.","operator_emphasis":"Declared priority only.","unresolved_tradeoff":"UNSPECIFIED; no settlement formula.","evidence_refs":[]})));
            let mut script = vec![];
            for _ in 0..3 {
                script.push(serde_json::to_string(&first).map_err(|e| e.to_string())?);
                script.push(serde_json::to_string(&second).map_err(|e| e.to_string())?);
            }
            save(&a[0], &script)?;
        }
        ("run-analysis", 7) => run(a)?,
        ("inspect-analysis", 2) => {
            print(&pipeline::inspect_package(&read(&a[0])?, &read(&a[1])?)?)?
        }
        ("report-analysis", 3) => {
            let text =
                nonverba_disputes::report::render_analysis_report(&read(&a[0])?, &read(&a[1])?)?;
            local::write_immutable(Path::new(&a[2]), text.as_bytes())?;
        }
        ("export-analysis", 3) => save(
            &a[2],
            &pipeline::export_package(&read(&a[0])?, &read(&a[1])?)?,
        )?,
        ("replay-analysis", 2) => print(&pipeline::replay(&read(&a[0])?, &read(&a[1])?)?)?,
        ("import-analysis", 3) => {
            let archive: PortableAnalysisV1 = read(&a[0])?;
            let report = pipeline::replay(&archive, &read(&a[1])?)?;
            if !report.analysis_package_valid {
                return Err(format!("IMPORT_INVALID: {:?}", report.diagnostics));
            }
            save(&a[2], &archive.package)?;
            print(&report)?;
        }
        _ => return Ok(false),
    }
    Ok(true)
}
pub fn print_help() {
    println!("{HELP}");
}

fn run(a: &[String]) -> Result<(), String> {
    let trust = read(&a[1])?;
    let mut package = verified_package(&a[0], &trust)?;
    let mode = match a[2].as_str() {
        "single" => RunMode::Single,
        "diagnostic" => RunMode::Diagnostic,
        _ => return Err("RUN_MODE".into()),
    };
    if Path::new(&a[4]).exists() {
        return Err("OUTPUT_EXISTS: choose a new immutable output".into());
    }
    let cancelled = Arc::new(AtomicBool::new(false));
    let done = Arc::new(AtomicBool::new(false));
    let token = runtime::CancellationToken::default();
    let backend: Box<dyn runtime::Backend> = match a[3].as_str() {
        "unavailable" => Box::new(runtime::UnavailableBackend),
        "mock" => Box::new(runtime::MockBackend::new(
            read::<Vec<String>>(&a[5])?.into_iter().map(Ok).collect(),
        )),
        "local" => Box::new(
            runtime::LlamaCppBackend::new(read(&a[5])?, token.clone())
                .map_err(|e| e.to_string())?,
        ),
        _ => return Err("BACKEND: unavailable, mock or local".into()),
    };
    let journal = format!("{}.attempts", a[4]);
    fs::create_dir(&journal).map_err(|e| format!("JOURNAL_NEW_DIRECTORY: {e}"))?;
    save(
        &format!("{journal}/run-intent.json"),
        &json!({"package_hash":encoding::digest(&package)?,"mode":mode,"backend":a[3],"seeds":package.specification.seeds,"note":"Incomplete journals are NOT complete valid exports. Do not silently retry or discard retained attempts."}),
    )?;
    let cancel_path = a[6].clone();
    if cancel_path != "none" && Path::new(&cancel_path).exists() {
        cancelled.store(true, Ordering::SeqCst);
        token.cancel();
    }
    let watch_cancel = cancelled.clone();
    let watch_done = done.clone();
    let watcher = std::thread::spawn(move || {
        while !watch_done.load(Ordering::SeqCst) {
            if cancel_path != "none" && Path::new(&cancel_path).exists() {
                watch_cancel.store(true, Ordering::SeqCst);
                token.cancel();
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    });
    let result = pipeline::run_schedule(
        &mut package,
        backend.as_ref(),
        mode,
        &cancelled,
        |attempt| {
            save(
                &format!(
                    "{journal}/{:03}-{}.json",
                    attempt.schedule_index,
                    encoding::digest(attempt)?
                ),
                attempt,
            )
        },
    );
    done.store(true, Ordering::SeqCst);
    watcher.join().map_err(|_| "CANCELLATION_WATCHER")?;
    // Preserve failed execution records before reporting a final validation error.
    save(&a[4], &package)?;
    result?;
    print(&pipeline::inspect_package(&package, &trust)?)
}
