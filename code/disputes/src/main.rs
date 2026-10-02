// SPDX-License-Identifier: AGPL-3.0-only
//! Native exact-consent entry point; inference is a separate command path.
mod commands;

use nonverba_disputes::{
    binding::{self, *},
    case::{
        AnalysisChallengeBodyV1, AnalysisChallengeV1, EvidenceSubmissionBodyV1,
        EvidenceSubmissionV1,
    },
    consent::{self, ConsentKind, ConsentReviewV1},
    preflight::{self, BaseSigningReviewV1, Decision, LocalDecisionV1, PreflightReviewV1},
    runtime,
};
use nonverba_requests::{
    encoding, local,
    model::{AssignmentBundle, Role, SignedQuote, SignedRequest, TrustConfiguration},
};
use serde::{Serialize, de::DeserializeOwned};
use std::{
    io::{self, BufRead, IsTerminal, Read, Write},
    path::Path,
    process::{Command, Stdio},
};
use zeroize::Zeroizing;

const HELP: &str = r#"Non Verba — dispute priors, analysis only (extension 1)

Base Contract formation and companion annex formation are separate.
R and O independently author their own 250 points; M has no preference vector.
Points express declared priors, not percentages, probabilities, truth or payment awards.
Settlement policy remains UNSPECIFIED. No analysis command signs or pays.

catalog [new-catalog.json]
draft-priors R <signed-request> <trust> <new-priors> [allocations.json]
draft-priors O <signed-request> <signed-quote> <trust> <new-priors> [allocations.json]
  Without allocations.json the editable draft has 50 points per dimension.
validate-priors <unsigned-priors> <trust>
verify-priors <signed-priors> <trust>
review priors <unsigned-priors> <trust> <new-review>
authorize <review> <independent-trust> <your-vault> <new-signed-record>
  Reads full review digest, then private passphrase from stdin. Empty digest cancels.
  Priors output is a signed declaration. Each owner signs only their own allocation.
spec <signed-R-profile> <signed-O-profile> <trust> <new-spec>
  Version-1 MODEL_UNAVAILABLE draft; no downloaded weights or invented hashes.
spec-v2 <signed-R-profile> <signed-O-profile> <trust> <new-spec>
  Explicit DP-2 projection, stage-schema and question-reconciliation draft.
spec-v3 <signed-R-profile> <signed-O-profile> <trust> <new-spec>
  Explicit bounded-output experiment version; earlier spec defaults remain unchanged.
spec-v4 <signed-R-profile> <signed-O-profile> <trust> <new-spec>
  Explicit v4 prompt/schema experiment draft; review and accept its exact new settings.
spec-v5 <signed-R-profile> <signed-O-profile> <trust> <new-spec>
  Explicit v5 prompt/schema experiment draft; earlier versions and defaults are retained.
preflight-review <signed-R-profile> <signed-O-profile> <spec> <trust> <new-preflight-review>
preflight-decide <preflight-review> <trust> <R|O|M> <accept|decline> <new-local-decision>
  Displays both exact profiles/settings before base endorsement. Confirm full digest.
  The decision is unsigned local workflow evidence, not another party's consent.
check-preflight <preflight-review> <local-decision> <candidate-base> <trust>
preflight-base-review <preflight-review> <local-decision> <candidate-base> <trust> <new-base-review>
authorize-preflight-base <base-review> <trust> <your-vault> <new-base-endorsement>
  Requires acceptance, unchanged sources, exact base review and existing core guards.
draft-context <base-bundle> <trust> <exact-Contract-hash> <signed-R-profile> <signed-O-profile> <spec> <new-context>
review context <context> <base-bundle> <trust> <new-review>
  Each R/O/M authorizes the same review independently; output has one endorsement.
authorize-preflight-context <preflight-review> <local-decision> <context-review> <trust> <your-vault> <new-annex>
attach-context <left-annex> <right-annex> <base-bundle> <trust> <new-annex>
inspect-context <base-bundle> <trust> [annex]
complete-setup <preflight-review> <local-decision> <annex> <base-bundle> <trust>
  Only this preflight-aware completion checks local acceptance AND exact annex match.
  A workflow refusal never undoes existing base rights or establishes robot safety.
review evidence <submission-body> <base-bundle> <complete-annex> <trust> <new-review>
review challenge <challenge-body> <base-bundle> <complete-annex> <trust> <new-review>
  Authorize returns an attributed evidence submission or challenge, never an action.

Case preparation, package/run/replay/export and challenge retention use the typed
JSON commands documented in disputes/README.md. Run `help` for this guide.

Use independently pinned trust; this tool does not establish real-world identity.
Keep a vault and its sibling signing-guards together. This is a software vault.
New file paths only: retained records are immutable, never overwritten.
Same accepted Contract cannot receive a replacement context through this signer.
A validated new Contract revision or new Assignment supports a new context;
earlier case records retain their exact earlier context and all base rights.
"#;

fn read<T: DeserializeOwned>(path: &str) -> Result<T, String> {
    local::read_json(Path::new(path))
}
fn typed<T: DeserializeOwned>(value: &serde_json::Value) -> Result<T, String> {
    encoding::strict_parse(&encoding::canonical(value)?)
}
fn save<T: Serialize>(path: &str, value: &T) -> Result<(), String> {
    local::write_immutable(Path::new(path), &encoding::canonical(value)?)
}
fn safe(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    for ch in text.chars() {
        if (ch.is_control() && ch != '\n' && ch != '\t')
            || matches!(ch,
            '\u{200e}' | '\u{200f}' | '\u{2028}' | '\u{2029}' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
        {
            result.push_str(&format!("\\u{:04x}", ch as u32));
        } else {
            result.push(ch);
        }
    }
    result
}
fn show<T: Serialize>(value: &T) -> Result<(), String> {
    println!(
        "{}",
        safe(&serde_json::to_string_pretty(value).map_err(|e| e.to_string())?)
    );
    Ok(())
}
fn line() -> Result<String, String> {
    let mut text = String::new();
    io::stdin()
        .lock()
        .take(1024)
        .read_line(&mut text)
        .map_err(|e| format!("INPUT: {e}"))?;
    if text.ends_with('\n') {
        text.pop();
        if text.ends_with('\r') {
            text.pop();
        }
    }
    Ok(text)
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

fn evidence_scope(body: &EvidenceSubmissionBodyV1) -> AttributionScopeV1 {
    AttributionScopeV1 {
        agreement_hash: body.agreement_hash.clone(),
        context_hash: body.context_hash.clone(),
        record_id: body.submission_id.clone(),
        kind: SubmissionKind::EvidenceSubmission,
        author_role: body.author_role,
    }
}
fn challenge_scope(body: &AnalysisChallengeBodyV1) -> AttributionScopeV1 {
    AttributionScopeV1 {
        agreement_hash: body.agreement_hash.clone(),
        context_hash: body.context_hash.clone(),
        record_id: body.challenge_id.clone(),
        kind: SubmissionKind::AnalysisChallenge,
        author_role: body.author_role,
    }
}
fn ensure_same_scope(
    actual: &AttributionScopeV1,
    expected: &AttributionScopeV1,
) -> Result<(), String> {
    if encoding::canonical(actual)? != encoding::canonical(expected)? {
        return Err("CONSENT_CONTEXT: typed body differs from exact reviewed attribution".into());
    }
    Ok(())
}

fn authorize(args: &[String]) -> Result<(), String> {
    if Path::new(&args[4]).exists() {
        return Err(
            "OUTPUT_EXISTS: choose a new immutable signed-record path before reviewing consent"
                .into(),
        );
    }
    let review: ConsentReviewV1 = read(&args[1])?;
    let trust: TrustConfiguration = read(&args[2])?;
    review.validate(&trust)?;
    // Ensure an attributed output has the same typed body and scope BEFORE the
    // password callback can run; arbitrary payloads are not a CLI signing mode.
    if review.kind == ConsentKind::Submission {
        let statement: AttributedStatementV1 = typed(&review.exact_content)?;
        let expected = match statement.scope.kind {
            SubmissionKind::EvidenceSubmission => evidence_scope(&typed(&statement.payload)?),
            SubmissionKind::AnalysisChallenge => challenge_scope(&typed(&statement.payload)?),
        };
        ensure_same_scope(&statement.scope, &expected)?;
    }
    print!("{}", review.render()?);
    print!("Confirm the full review digest, or Enter to cancel: ");
    io::stdout().flush().map_err(|e| e.to_string())?;
    let approved = line()?;
    let signature = consent::authorize(
        &review,
        Some(&approved),
        &trust,
        Path::new(&args[3]),
        secret,
    )?;
    match review.kind {
        ConsentKind::Profile => save(
            &args[4],
            &SignedDeclaredPriorsV1 {
                profile: typed(&review.exact_content)?,
                authorization: signature,
            },
        )?,
        ConsentKind::Context => save(
            &args[4],
            &SignedDisputeContextV1 {
                context: typed(&review.exact_content)?,
                endorsements: vec![signature],
            },
        )?,
        ConsentKind::Submission => {
            let statement: AttributedStatementV1 = typed(&review.exact_content)?;
            match statement.scope.kind {
                SubmissionKind::EvidenceSubmission => save(
                    &args[4],
                    &EvidenceSubmissionV1 {
                        body: typed(&statement.payload)?,
                        authorization: signature,
                    },
                )?,
                SubmissionKind::AnalysisChallenge => save(
                    &args[4],
                    &AnalysisChallengeV1 {
                        body: typed(&statement.payload)?,
                        authorization: signature,
                    },
                )?,
            }
        }
    }
    println!("Saved exact signed companion record. No financial action was submitted.");
    Ok(())
}

fn run(args: &[String]) -> Result<(), String> {
    let command = args.first().map(String::as_str).unwrap_or("help");
    match command {
        "preflight-review" if args.len() == 6 => {
            let trust = read(&args[4])?;
            let review =
                PreflightReviewV1::new(read(&args[1])?, read(&args[2])?, read(&args[3])?, &trust)?;
            save(&args[5], &review)?;
            println!("{}", safe(&review.render(&trust)?));
            Ok(())
        }
        "preflight-decide" if args.len() == 6 => {
            let review: PreflightReviewV1 = read(&args[1])?;
            let trust = read(&args[2])?;
            let role = match args[3].as_str() {
                "R" => Role::Requester,
                "O" => Role::Operator,
                "M" => Role::Mediator,
                _ => return Err("ROLE: use R/O/M".into()),
            };
            let choice = match args[4].as_str() {
                "accept" => Decision::Accept,
                "decline" => Decision::Decline,
                _ => return Err("PREFLIGHT_DECISION: use accept or decline".into()),
            };
            println!("{}", safe(&review.render(&trust)?));
            print!("Confirm full preflight digest to record {choice:?}, or Enter to cancel: ");
            io::stdout().flush().map_err(|e| e.to_string())?;
            let decision = preflight::decide(&review, &trust, role, choice, &line()?)?;
            save(&args[5], &decision)?;
            show(&decision)
        }
        "check-preflight" if args.len() == 5 => {
            preflight::check_candidate(
                &read(&args[1])?,
                &read(&args[2])?,
                &read(&args[3])?,
                &read(&args[4])?,
            )?;
            println!(
                "PREFLIGHT_MATCH: locally accepted sources match; no base endorsement or annex completion is implied."
            );
            Ok(())
        }
        "preflight-base-review" if args.len() == 6 => {
            let trust = read(&args[4])?;
            let review = BaseSigningReviewV1::new(
                read(&args[1])?,
                read(&args[2])?,
                read(&args[3])?,
                &trust,
            )?;
            save(&args[5], &review)?;
            println!("{}", safe(&review.render(&trust)?));
            Ok(())
        }
        "authorize-preflight-base" if args.len() == 5 => {
            if Path::new(&args[4]).exists() {
                return Err("OUTPUT_EXISTS: choose a new signed-record path".into());
            }
            let review: BaseSigningReviewV1 = read(&args[1])?;
            let trust = read(&args[2])?;
            println!("{}", safe(&review.render(&trust)?));
            print!("Confirm full base signing review digest, or Enter to cancel: ");
            io::stdout().flush().map_err(|e| e.to_string())?;
            let signature =
                preflight::authorize_base(&review, &line()?, &trust, Path::new(&args[3]), secret)?;
            save(&args[4], &signature)?;
            println!("Saved exact base endorsement. Annex formation remains separate.");
            Ok(())
        }
        "authorize-preflight-context" if args.len() == 7 => {
            if Path::new(&args[6]).exists() {
                return Err("OUTPUT_EXISTS: choose a new signed-record path".into());
            }
            let preflight: PreflightReviewV1 = read(&args[1])?;
            let decision: LocalDecisionV1 = read(&args[2])?;
            let review: ConsentReviewV1 = read(&args[3])?;
            let trust = read(&args[4])?;
            let context: DisputeContextV1 = typed(&review.exact_content)?;
            preflight::check_context(
                &preflight,
                &decision,
                &context,
                review
                    .retained_base
                    .as_ref()
                    .ok_or("PREFLIGHT_BASE: retained base required")?,
                &trust,
            )?;
            println!("{}", safe(&review.render()?));
            print!("Confirm full context review digest, or Enter to cancel: ");
            io::stdout().flush().map_err(|e| e.to_string())?;
            let signature = preflight::authorize_context(
                &preflight,
                &decision,
                &review,
                &line()?,
                &trust,
                Path::new(&args[5]),
                secret,
            )?;
            save(
                &args[6],
                &SignedDisputeContextV1 {
                    context,
                    endorsements: vec![signature],
                },
            )?;
            Ok(())
        }
        "complete-setup" if args.len() == 6 => show(&preflight::complete_setup(
            &read(&args[1])?,
            &read(&args[2])?,
            &read(&args[3])?,
            &read(&args[4])?,
            &read(&args[5])?,
        )?),
        "help" | "--help" | "guide" if args.len() <= 1 => {
            print!("{HELP}");
            commands::print_help();
            Ok(())
        }
        "catalog" | "dictionary" if args.len() == 1 || args.len() == 2 => {
            if args.len() == 2 {
                save(&args[1], &priors_catalog())?;
            }
            show(&priors_catalog())
        }
        "draft-priors" | "draft-profile" => {
            let (provenance, trust_path, output, allocation_path) = match args.get(1).map(String::as_str) {
                Some("R") if args.len() == 5 || args.len() == 6 => (ProfileProvenance::Request { signed_request: read::<SignedRequest>(&args[2])? }, &args[3], &args[4], args.get(5)),
                Some("O") if args.len() == 6 || args.len() == 7 => (ProfileProvenance::Quote { signed_request: read::<SignedRequest>(&args[2])?, signed_quote: read::<SignedQuote>(&args[3])? }, &args[4], &args[5], args.get(6)),
                _ => return Err("USAGE: draft-priors R request trust out [allocations] | O request quote trust out [allocations]".into()),
            };
            let allocations = allocation_path
                .map(|path| read::<Vec<Allocation>>(path))
                .transpose()?
                .unwrap_or_else(balanced_allocations);
            let profile = draft_declared_priors(provenance, allocations, &read(trust_path)?)?;
            save(output, &profile)?;
            println!(
                "Saved editable unsigned declared priors; no consent or declaration defaults were adopted."
            );
            Ok(())
        }
        "validate-priors" | "validate-profile" if args.len() == 3 => {
            validate_declared_priors(&read(&args[1])?, &read(&args[2])?)?;
            println!("VALID_DRAFT; unsigned validation is not consent.");
            Ok(())
        }
        "verify-priors" | "verify-profile" if args.len() == 3 => {
            println!(
                "Verified declared priors content digest: {}",
                verify_declared_priors(&read(&args[1])?, &read(&args[2])?)?
            );
            Ok(())
        }
        "spec" | "spec-v2" | "spec-v3" | "spec-v4" | "spec-v5" if args.len() == 5 => {
            let r: SignedDeclaredPriorsV1 = read(&args[1])?;
            let o: SignedDeclaredPriorsV1 = read(&args[2])?;
            let trust = read(&args[3])?;
            if r.profile.author.role.code() != "R" || o.profile.author.role.code() != "O" {
                return Err("DISPUTE_AUTHOR: expected separate R then O profiles".into());
            }
            let constructor = match command {
                "spec-v5" => runtime::development_spec_v5,
                "spec-v4" => runtime::development_spec_v4,
                "spec-v3" => runtime::development_spec_v3,
                "spec-v2" => runtime::development_spec_v2,
                _ => runtime::development_spec,
            };
            let spec = constructor(
                priors_catalog_digest()?,
                verify_declared_priors(&r, &trust)?,
                verify_declared_priors(&o, &trust)?,
            );
            spec.validate()?;
            save(&args[4], &spec)?;
            println!(
                "Saved MODEL_UNAVAILABLE analysis specification draft. Local inference has not run."
            );
            Ok(())
        }
        "draft-context" if args.len() == 8 => {
            let base = read(&args[1])?;
            let trust = read(&args[2])?;
            let context = draft_context(
                &base,
                &args[3],
                read(&args[4])?,
                read(&args[5])?,
                read(&args[6])?,
                &trust,
            )?;
            save(&args[7], &context)?;
            println!("Saved unsigned context; all R/O/M endorsements remain required.");
            Ok(())
        }
        "review" => {
            let review = match args.get(1).map(String::as_str) {
                Some("priors" | "profile") if args.len() == 5 => {
                    ConsentReviewV1::profile(read(&args[2])?, &read(&args[3])?)?
                }
                Some("context") if args.len() == 6 => {
                    ConsentReviewV1::context(read(&args[2])?, &read(&args[3])?, &read(&args[4])?)?
                }
                Some("evidence") if args.len() == 7 => {
                    let body: EvidenceSubmissionBodyV1 = read(&args[2])?;
                    ConsentReviewV1::submission(
                        &body,
                        &evidence_scope(&body),
                        &read(&args[3])?,
                        &read(&args[4])?,
                        &read(&args[5])?,
                    )?
                }
                Some("challenge") if args.len() == 7 => {
                    let body: AnalysisChallengeBodyV1 = read(&args[2])?;
                    ConsentReviewV1::submission(
                        &body,
                        &challenge_scope(&body),
                        &read(&args[3])?,
                        &read(&args[4])?,
                        &read(&args[5])?,
                    )?
                }
                _ => {
                    return Err("USAGE: review profile|context|evidence|challenge; see help".into());
                }
            };
            save(
                args.last().ok_or("USAGE: missing new review path")?,
                &review,
            )?;
            print!("{}", review.render()?);
            Ok(())
        }
        "authorize" if args.len() == 5 => authorize(args),
        "attach-context" if args.len() == 6 => {
            let merged = merge_context_endorsements(&read(&args[1])?, &read(&args[2])?)?;
            let base: AssignmentBundle = read(&args[3])?;
            let trust = read(&args[4])?;
            binding::validate_context(&merged.context, &base, &trust)?;
            let report = verify_context(Some(&merged), &base, &trust)?;
            save(&args[5], &merged)?;
            show(&report)
        }
        "inspect-context" if args.len() == 3 || args.len() == 4 => {
            let annex = args
                .get(3)
                .map(|path| read::<SignedDisputeContextV1>(path))
                .transpose()?;
            show(&verify_context(
                annex.as_ref(),
                &read(&args[1])?,
                &read(&args[2])?,
            )?)
        }
        _ => {
            if commands::dispatch(args)? {
                Ok(())
            } else {
                Err("USAGE: unsupported command or arguments; run help".into())
            }
        }
    }
}

fn main() {
    if let Err(error) = run(&std::env::args().skip(1).collect::<Vec<_>>()) {
        eprintln!("{}", safe(&error));
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn terminal_text_escapes_control_and_bidirectional_overrides() {
        assert_eq!(safe("a\u{1b}b\u{202e}c\n"), "a\\u001bb\\u202ec\n");
    }
    #[test]
    fn attribution_output_cannot_relabel_reviewed_role_or_record() {
        let a = AttributionScopeV1 {
            agreement_hash: "a".repeat(64),
            context_hash: "b".repeat(64),
            record_id: "submission-1".into(),
            kind: SubmissionKind::EvidenceSubmission,
            author_role: nonverba_requests::model::Role::Requester,
        };
        let mut b = a.clone();
        b.author_role = nonverba_requests::model::Role::Operator;
        assert!(ensure_same_scope(&a, &b).is_err());
        b = a.clone();
        b.record_id = "submission-2".into();
        assert!(ensure_same_scope(&a, &b).is_err());
        ensure_same_scope(&a, &a).unwrap();
    }
}
