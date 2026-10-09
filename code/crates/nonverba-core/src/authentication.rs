// SPDX-License-Identifier: AGPL-3.0-only
//! Isolated authentication workflow and reuse policy for developer inspection.
//!
//! No identity or liveness validator exists here. All supplied times, contexts
//! and claims are untrusted fixture inputs. Even a purported validated success
//! cannot produce genuine authentication. Registration verification, contractual
//! authority and sensor consent are separate boundaries.

use serde::{Deserialize, Serialize};

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthenticationMode {
    Operator,
    Requester,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReuseScope {
    Account,
    Device,
    Session,
    Task,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuthenticationContext {
    pub account_id: String,
    pub principal_id: String,
    pub device_id: String,
    pub session_id: String,
    #[serde(default)]
    pub task_id: Option<String>,
}

impl AuthenticationContext {
    pub(crate) fn validate(&self) -> Result<(), String> {
        for value in [
            &self.account_id,
            &self.principal_id,
            &self.device_id,
            &self.session_id,
        ] {
            identifier(value)?;
        }
        if let Some(task) = &self.task_id {
            identifier(task)?;
        }
        Ok(())
    }
}

pub(crate) fn identifier(value: &str) -> Result<(), String> {
    if value.trim().is_empty() || value.len() > 256 {
        return Err("Identifiers must contain 1 to 256 nonblank bytes".into());
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthenticationStatus {
    RequirementPresented,
    CaptureActive,
    CaptureCompleteValidationUnimplemented,
    ValidationPending,
    SimulatedSuccess,
    /// Accepted as an imported claim only so it can explicitly be refused.
    ValidatedSuccess,
    Denied,
    Cancelled,
    Expired,
    Failed,
    Revoked,
}

impl AuthenticationStatus {
    fn terminal(self) -> bool {
        matches!(
            self,
            Self::SimulatedSuccess
                | Self::ValidatedSuccess
                | Self::Denied
                | Self::Cancelled
                | Self::Expired
                | Self::Failed
                | Self::Revoked
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuthenticationResult {
    pub operation_id: String,
    pub context: AuthenticationContext,
    pub mode: AuthenticationMode,
    pub policy_id: String,
    pub reuse_scope: ReuseScope,
    pub issued_at: u64,
    #[serde(default)]
    pub completed_at: Option<u64>,
    pub expires_at: u64,
    pub status: AuthenticationStatus,
    /// Required, rather than defaulted: stripping the marker is invalid input.
    pub simulation: bool,
}

impl AuthenticationResult {
    fn validate(&self) -> Result<(), String> {
        identifier(&self.operation_id)?;
        identifier(&self.policy_id)?;
        self.context.validate()?;
        if self.expires_at <= self.issued_at
            || self
                .completed_at
                .is_some_and(|time| time < self.issued_at || time >= self.expires_at)
            || (self.reuse_scope == ReuseScope::Task && self.context.task_id.is_none())
        {
            return Err("Authentication result has invalid validity or task scope".into());
        }
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuthenticationCreateInput {
    pub now_secs: u64,
    pub operation_id: String,
    pub context: AuthenticationContext,
    pub mode: AuthenticationMode,
    pub policy_id: String,
    pub reuse_scope: ReuseScope,
    pub expires_at: u64,
    #[serde(default = "simulation_default")]
    pub simulation: bool,
}

fn simulation_default() -> bool {
    true
}

#[derive(Debug, Clone, Serialize)]
pub struct AuthenticationTransitionReport {
    pub accepted: bool,
    pub result: AuthenticationResult,
    /// An adapter must actually close resources before confirming cleanup.
    pub close_capture: bool,
    pub reason: String,
    pub simulation: bool,
    pub authenticated: bool,
}

fn report(
    result: AuthenticationResult,
    accepted: bool,
    reason: &str,
) -> AuthenticationTransitionReport {
    AuthenticationTransitionReport {
        close_capture: result.status != AuthenticationStatus::CaptureActive,
        result,
        accepted,
        reason: reason.into(),
        simulation: true,
        authenticated: false,
    }
}

pub fn create(input: AuthenticationCreateInput) -> Result<AuthenticationTransitionReport, String> {
    let result = AuthenticationResult {
        operation_id: input.operation_id,
        context: input.context,
        mode: input.mode,
        policy_id: input.policy_id,
        reuse_scope: input.reuse_scope,
        issued_at: input.now_secs,
        completed_at: None,
        expires_at: input.expires_at,
        status: AuthenticationStatus::RequirementPresented,
        simulation: input.simulation,
    };
    result.validate()?;
    Ok(report(result, true, "requirement_presented"))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthenticationAction {
    Start,
    CaptureComplete,
    ValidationPending,
    SimulateSuccess,
    Deny,
    Cancel,
    Fail,
    Expire,
    Revoke,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuthenticationTransitionInput {
    pub now_secs: u64,
    pub result: AuthenticationResult,
    pub action: AuthenticationAction,
    #[serde(default)]
    pub deliberate: bool,
}

pub fn transition(
    input: AuthenticationTransitionInput,
) -> Result<AuthenticationTransitionReport, String> {
    use AuthenticationAction as Action;
    use AuthenticationStatus as Status;
    let mut result = input.result;
    result.validate()?;
    if input.now_secs < result.issued_at
        || result
            .completed_at
            .is_some_and(|time| time > input.now_secs)
    {
        result.status = Status::Failed;
        result.completed_at = None;
        return Ok(report(result, false, "invalid_clock"));
    }
    // Revocation remains possible after any result, including simulated success.
    if input.action == Action::Revoke {
        result.status = Status::Revoked;
        return Ok(report(result, true, "revoked"));
    }
    if result.status.terminal() {
        return Ok(report(result, false, "terminal_result_cannot_resume"));
    }
    if input.now_secs >= result.expires_at {
        result.status = Status::Expired;
        return Ok(report(result, true, "expired"));
    }
    let (next, reason) = match input.action {
        Action::Start if result.status == Status::RequirementPresented && input.deliberate => {
            if result.mode == AuthenticationMode::Operator {
                (Status::CaptureActive, "operator_capture_started")
            } else {
                // The Requester method is intentionally unspecified and synthetic.
                (Status::ValidationPending, "requester_steps_pending")
            }
        }
        Action::CaptureComplete
            if result.mode == AuthenticationMode::Operator
                && result.status == Status::CaptureActive =>
        {
            (
                Status::CaptureCompleteValidationUnimplemented,
                "capture_completed_identity_validation_unimplemented",
            )
        }
        Action::ValidationPending
            if result.status == Status::CaptureCompleteValidationUnimplemented =>
        {
            (
                Status::ValidationPending,
                "identity_validation_unimplemented",
            )
        }
        Action::SimulateSuccess
            if result.simulation
                && matches!(
                    result.status,
                    Status::CaptureCompleteValidationUnimplemented | Status::ValidationPending
                ) =>
        {
            result.completed_at = Some(input.now_secs);
            (Status::SimulatedSuccess, "simulated_success_only")
        }
        Action::Deny => (Status::Denied, "denied"),
        Action::Cancel => (Status::Cancelled, "cancelled"),
        Action::Fail => (Status::Failed, "failed"),
        Action::Expire => (Status::Expired, "expired"),
        _ => return Ok(report(result, false, "action_not_permitted")),
    };
    result.status = next;
    Ok(report(result, true, reason))
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuthenticationRequirement {
    pub mode: AuthenticationMode,
    pub policy_id: String,
    pub reuse_scope: ReuseScope,
    pub max_age_secs: u64,
    #[serde(default)]
    pub fresh_after_secs: Option<u64>,
    /// Opt-in only for the isolated developer harness, never genuine assurance.
    pub allow_simulated: bool,
    /// Only the selected Operator inspection policy may request face continuity.
    #[serde(default)]
    pub face_required: bool,
    /// Current private-store reference, so deletion/replacement invalidates reuse.
    #[serde(default)]
    pub face_reference_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuthenticationAssessInput {
    pub now_secs: u64,
    pub context: AuthenticationContext,
    pub requirement: AuthenticationRequirement,
    #[serde(default)]
    pub result: Option<AuthenticationResult>,
    /// Separate comparison evidence; never a trusted presence/authentication claim.
    #[serde(default)]
    pub face_report: Option<crate::face_identity::FaceReport>,
}

#[derive(Debug, Serialize)]
pub struct AuthenticationAssessment {
    pub authenticated: bool,
    pub satisfied_for_simulation: bool,
    pub simulation: bool,
    pub status: Option<AuthenticationStatus>,
    pub reason: String,
}

pub fn assess(input: AuthenticationAssessInput) -> Result<AuthenticationAssessment, String> {
    input.context.validate()?;
    identifier(&input.requirement.policy_id)?;
    if input.requirement.reuse_scope == ReuseScope::Task && input.context.task_id.is_none() {
        return Err("Task authentication requirements need a task identifier".into());
    }
    let mut output = AuthenticationAssessment {
        authenticated: false,
        satisfied_for_simulation: false,
        simulation: true,
        status: input.result.as_ref().map(|result| result.status),
        reason: String::new(),
    };
    output.reason = assessment_reason(&input)?.into();
    output.satisfied_for_simulation = output.reason == "simulated_requirement_satisfied";
    Ok(output)
}

fn assessment_reason(input: &AuthenticationAssessInput) -> Result<&'static str, String> {
    if input.requirement.mode == AuthenticationMode::Requester
        && (input.requirement.face_required
            || input.requirement.face_reference_id.is_some()
            || input.face_report.is_some())
    {
        return Ok("requester_face_not_required");
    }
    let Some(result) = &input.result else {
        return Ok("authentication_missing");
    };
    result.validate()?;
    let context = &input.context;
    let requirement = &input.requirement;
    if result.context.account_id != context.account_id
        || result.context.principal_id != context.principal_id
    {
        return Ok("account_or_principal_mismatch");
    }
    if result.mode != requirement.mode {
        return Ok("mode_mismatch");
    }
    if result.policy_id != requirement.policy_id {
        return Ok("policy_mismatch");
    }
    if result.status == AuthenticationStatus::Revoked {
        return Ok("authentication_revoked");
    }
    if input.now_secs < result.issued_at {
        return Ok("invalid_clock");
    }
    if input.now_secs >= result.expires_at {
        return Ok("authentication_expired");
    }
    // Reuse obeys BOTH the issued scope and the caller's narrower requirement.
    for scope in [result.reuse_scope, requirement.reuse_scope] {
        let matches = match scope {
            ReuseScope::Account => true,
            ReuseScope::Device => result.context.device_id == context.device_id,
            ReuseScope::Session => {
                result.context.device_id == context.device_id
                    && result.context.session_id == context.session_id
            }
            ReuseScope::Task => {
                result.context.device_id == context.device_id
                    && result.context.session_id == context.session_id
                    && result.context.task_id.is_some()
                    && result.context.task_id == context.task_id
            }
        };
        if !matches {
            return Ok("reuse_scope_mismatch");
        }
    }
    if requirement.face_required {
        let Some(reference_id) = &requirement.face_reference_id else {
            return Ok("face_enrollment_missing");
        };
        identifier(reference_id)?;
        let Some(face) = &input.face_report else {
            return Ok("face_check_required");
        };
        if face.binding.account_id != result.context.account_id
            || face.binding.principal_id != result.context.principal_id
            || face.binding.device_id != result.context.device_id
            || face.binding.operation_id != result.operation_id
            || face.reference_id.as_ref() != Some(reference_id)
            || face.evaluated_at < result.issued_at
            || face.evaluated_at > input.now_secs
            || !face
                .model
                .as_ref()
                .is_some_and(crate::face_identity::FaceModelSpec::is_selected)
        {
            return Ok("face_check_binding_mismatch");
        }
        if face.status != crate::face_identity::FaceStatus::Match
            || face.embedding_match != Some(true)
        {
            return Ok("face_match_required");
        }
        if result.status != AuthenticationStatus::SimulatedSuccess || !result.simulation {
            return Ok("operator_presence_validation_unresolved");
        }
    }
    if result.status != AuthenticationStatus::SimulatedSuccess || !result.simulation {
        // No status or caller-supplied time can substitute for the future validator.
        return Ok("identity_validation_unimplemented");
    }
    if !requirement.allow_simulated {
        return Ok("simulation_not_permitted");
    }
    let Some(completed) = result.completed_at else {
        return Ok("completion_time_missing");
    };
    if completed > input.now_secs {
        return Ok("invalid_clock");
    }
    if input.now_secs - completed > requirement.max_age_secs {
        return Ok("authentication_too_old");
    }
    if requirement
        .fresh_after_secs
        .is_some_and(|time| completed < time)
    {
        return Ok("fresh_authentication_required");
    }
    Ok("simulated_requirement_satisfied")
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn authentication_create(input_json: &str) -> Result<String, String> {
    serde_json::to_string(&create(crate::parse(input_json)?)?).map_err(crate::err)
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn authentication_transition(input_json: &str) -> Result<String, String> {
    serde_json::to_string(&transition(crate::parse(input_json)?)?).map_err(crate::err)
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn authentication_assess(input_json: &str) -> Result<String, String> {
    serde_json::to_string(&assess(crate::parse(input_json)?)?).map_err(crate::err)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn context() -> AuthenticationContext {
        AuthenticationContext {
            account_id: "account".into(),
            principal_id: "person".into(),
            device_id: "device-a".into(),
            session_id: "session-a".into(),
            task_id: Some("task-a".into()),
        }
    }

    fn session(mode: AuthenticationMode) -> AuthenticationResult {
        create(AuthenticationCreateInput {
            now_secs: 100,
            operation_id: "auth-a".into(),
            context: context(),
            mode,
            policy_id: "policy-a".into(),
            reuse_scope: ReuseScope::Account,
            expires_at: 200,
            simulation: true,
        })
        .unwrap()
        .result
    }

    fn step(
        result: AuthenticationResult,
        action: AuthenticationAction,
        now_secs: u64,
    ) -> AuthenticationTransitionReport {
        transition(AuthenticationTransitionInput {
            now_secs,
            result,
            action,
            deliberate: true,
        })
        .unwrap()
    }

    fn success() -> AuthenticationResult {
        let started = step(
            session(AuthenticationMode::Operator),
            AuthenticationAction::Start,
            101,
        );
        let captured = step(started.result, AuthenticationAction::CaptureComplete, 102);
        step(captured.result, AuthenticationAction::SimulateSuccess, 103).result
    }

    fn requirement(result: AuthenticationResult) -> AuthenticationAssessInput {
        AuthenticationAssessInput {
            now_secs: 110,
            context: context(),
            requirement: AuthenticationRequirement {
                mode: AuthenticationMode::Operator,
                policy_id: "policy-a".into(),
                reuse_scope: ReuseScope::Account,
                max_age_secs: 20,
                fresh_after_secs: None,
                allow_simulated: true,
                face_required: false,
                face_reference_id: None,
            },
            result: Some(result),
            face_report: None,
        }
    }

    #[test]
    fn capture_is_not_authentication_and_cannot_enable_work() {
        let initial = session(AuthenticationMode::Operator);
        let not_deliberate = transition(AuthenticationTransitionInput {
            now_secs: 101,
            result: initial.clone(),
            action: AuthenticationAction::Start,
            deliberate: false,
        })
        .unwrap();
        assert!(!not_deliberate.accepted);
        assert!(not_deliberate.close_capture);
        let started = step(initial, AuthenticationAction::Start, 101);
        assert!(!started.close_capture);
        let captured = step(started.result, AuthenticationAction::CaptureComplete, 102);
        assert!(captured.close_capture);
        assert_eq!(
            captured.result.status,
            AuthenticationStatus::CaptureCompleteValidationUnimplemented
        );
        let assessment = assess(requirement(captured.result)).unwrap();
        assert!(!assessment.authenticated);
        assert!(!assessment.satisfied_for_simulation);
    }

    #[test]
    fn requester_steps_do_not_start_operator_camera() {
        let started = step(
            session(AuthenticationMode::Requester),
            AuthenticationAction::Start,
            101,
        );
        assert!(started.close_capture);
        assert_eq!(
            started.result.status,
            AuthenticationStatus::ValidationPending
        );
        let simulated = step(started.result, AuthenticationAction::SimulateSuccess, 102);
        assert_eq!(
            assess(requirement(simulated.result)).unwrap().reason,
            "mode_mismatch"
        );
    }

    #[test]
    fn simulated_success_never_becomes_genuine_authentication() {
        let result = success();
        let allowed = assess(requirement(result.clone())).unwrap();
        assert!(allowed.satisfied_for_simulation);
        assert!(!allowed.authenticated);
        let mut real_requirement = requirement(result.clone());
        real_requirement.requirement.allow_simulated = false;
        assert_eq!(
            assess(real_requirement).unwrap().reason,
            "simulation_not_permitted"
        );
        let mut forged = result;
        forged.simulation = false;
        forged.status = AuthenticationStatus::ValidatedSuccess;
        let refused = assess(requirement(forged)).unwrap();
        assert!(!refused.authenticated);
        assert!(!refused.satisfied_for_simulation);
        let mut json = serde_json::to_value(success()).unwrap();
        json.as_object_mut().unwrap().remove("simulation");
        assert!(serde_json::from_value::<AuthenticationResult>(json).is_err());
    }

    #[test]
    fn selected_operator_face_policy_binds_current_reference_and_operation_without_authenticating()
    {
        let mut input = requirement(success());
        input.requirement.face_required = true;
        input.requirement.face_reference_id = Some("reference-a".into());
        assert_eq!(assess(input).unwrap().reason, "face_check_required");
        let mut input = requirement(success());
        input.requirement.face_required = true;
        input.requirement.face_reference_id = Some("reference-a".into());
        input.face_report = Some(crate::face_identity::fixture_comparison("auth-a", true));
        let allowed = assess(input).unwrap();
        assert!(allowed.satisfied_for_simulation);
        assert!(!allowed.authenticated);
        for changed in ["reference", "operation", "device", "mode", "missing"] {
            let mut input = requirement(success());
            input.requirement.face_required = true;
            input.requirement.face_reference_id = Some("reference-a".into());
            input.face_report = Some(crate::face_identity::fixture_comparison("auth-a", true));
            match changed {
                "reference" => {
                    input.requirement.face_reference_id = Some("replacement-reference".into())
                }
                "operation" => {
                    input.face_report.as_mut().unwrap().binding.operation_id = "other".into()
                }
                "device" => input.face_report.as_mut().unwrap().binding.device_id = "other".into(),
                "mode" => input.requirement.mode = AuthenticationMode::Requester,
                "missing" => input.requirement.face_reference_id = None,
                _ => unreachable!(),
            }
            assert!(
                !assess(input).unwrap().satisfied_for_simulation,
                "{changed}"
            );
        }
        let mut real = requirement(success());
        real.requirement.face_required = true;
        real.requirement.face_reference_id = Some("reference-a".into());
        real.face_report = Some(crate::face_identity::fixture_comparison("auth-a", false));
        real.result.as_mut().unwrap().status = AuthenticationStatus::ValidatedSuccess;
        real.result.as_mut().unwrap().simulation = false;
        let report = assess(real).unwrap();
        assert!(!report.authenticated && !report.satisfied_for_simulation);
        assert_eq!(report.reason, "operator_presence_validation_unresolved");
    }

    #[test]
    fn reuse_checks_account_principal_policy_scope_freshness_and_expiry() {
        let result = success();
        let mut next_task = requirement(result.clone());
        next_task.context.task_id = Some("task-b".into());
        assert!(assess(next_task).unwrap().satisfied_for_simulation);
        for changed in [
            "account",
            "principal",
            "policy",
            "mode",
            "time",
            "expiry",
            "fresh",
        ] {
            let mut input = requirement(result.clone());
            match changed {
                "account" => input.context.account_id = "other".into(),
                "principal" => input.context.principal_id = "other".into(),
                "policy" => input.requirement.policy_id = "other".into(),
                "mode" => input.requirement.mode = AuthenticationMode::Requester,
                "time" => input.now_secs = 124,
                "expiry" => input.now_secs = 200,
                "fresh" => input.requirement.fresh_after_secs = Some(104),
                _ => unreachable!(),
            }
            assert!(
                !assess(input).unwrap().satisfied_for_simulation,
                "{changed}"
            );
        }
        for scope in [ReuseScope::Device, ReuseScope::Session, ReuseScope::Task] {
            let mut input = requirement(result.clone());
            input.result.as_mut().unwrap().reuse_scope = scope;
            input.context.device_id = "other".into();
            assert_eq!(assess(input).unwrap().reason, "reuse_scope_mismatch");
        }
        let mut narrowed = requirement(result.clone());
        narrowed.requirement.reuse_scope = ReuseScope::Task;
        narrowed.context.task_id = Some("other".into());
        assert_eq!(assess(narrowed).unwrap().reason, "reuse_scope_mismatch");
    }

    #[test]
    fn cancel_expiry_failure_and_revocation_close_capture_and_reject_late_completion() {
        for action in [
            AuthenticationAction::Cancel,
            AuthenticationAction::Fail,
            AuthenticationAction::Expire,
            AuthenticationAction::Revoke,
        ] {
            let started = step(
                session(AuthenticationMode::Operator),
                AuthenticationAction::Start,
                101,
            );
            let stopped = step(started.result, action, 102);
            assert!(stopped.close_capture);
            let late = step(
                stopped.result.clone(),
                AuthenticationAction::CaptureComplete,
                103,
            );
            assert!(!late.accepted);
            assert!(late.close_capture);
            assert_eq!(late.result.status, stopped.result.status);
        }
        let started = step(
            session(AuthenticationMode::Operator),
            AuthenticationAction::Start,
            101,
        );
        let expired = step(started.result, AuthenticationAction::CaptureComplete, 200);
        assert_eq!(expired.result.status, AuthenticationStatus::Expired);
        assert!(expired.close_capture);
        let revoked = step(success(), AuthenticationAction::Revoke, 110);
        assert_eq!(
            assess(requirement(revoked.result)).unwrap().reason,
            "authentication_revoked"
        );
    }
}
