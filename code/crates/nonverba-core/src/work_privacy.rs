// SPDX-License-Identifier: AGPL-3.0-only
//! Shared work-state, notification and sensor policy for an isolated simulation.
//!
//! Inputs are local developer fixtures, not signed coordinator authority. The
//! policy reports simulated eligibility only; platform adapters must stop actual
//! resources, expire active leases and discard queued callbacks themselves. A
//! simulated acknowledgment is never proof of deployed account-wide shutdown.

use crate::authentication::identifier;
use serde::{Deserialize, Serialize};

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkState {
    Unknown,
    Available,
    Hold,
    ClockedOut,
    SignedOut,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PrivacyState {
    pub account_id: String,
    pub state: WorkState,
    pub revision: u64,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NotificationDisposition {
    Normal,
    Silent,
}

fn notifications(state: WorkState) -> NotificationDisposition {
    match state {
        WorkState::Available | WorkState::Hold => NotificationDisposition::Normal,
        WorkState::Unknown | WorkState::ClockedOut | WorkState::SignedOut => {
            NotificationDisposition::Silent
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkAction {
    Hold,
    ClockOut,
    SignOut,
    ClockIn,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkCommand {
    pub account_id: String,
    pub action: WorkAction,
    pub expected_revision: u64,
    pub authorized_controller: bool,
    pub deliberate: bool,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkTransitionInput {
    pub now_secs: u64,
    pub state: PrivacyState,
    pub command: WorkCommand,
}

#[derive(Debug, Serialize)]
pub struct WorkTransitionReport {
    pub accepted: bool,
    pub state: PrivacyState,
    pub revoke_operations: bool,
    pub reason: String,
    pub simulation: bool,
    pub account_wide_protection: bool,
    pub notification_disposition: NotificationDisposition,
    pub profile_visible: bool,
}

pub fn transition(input: WorkTransitionInput) -> Result<WorkTransitionReport, String> {
    identifier(&input.state.account_id)?;
    identifier(&input.command.account_id)?;
    let mut state = input.state;
    let command = input.command;
    let reason = if command.account_id != state.account_id {
        "account_mismatch"
    } else if !command.authorized_controller || !command.deliberate {
        "authorized_deliberate_controller_required"
    } else if command.expected_revision > state.revision
        || (command.action == WorkAction::ClockIn && command.expected_revision != state.revision)
    {
        "stale_revision"
    } else if input.now_secs < state.updated_at {
        "invalid_clock"
    } else if state.revision == u64::MAX {
        "revision_exhausted"
    } else {
        "state_changed"
    };
    let accepted = reason == "state_changed";
    if accepted {
        state.state = match command.action {
            WorkAction::Hold => WorkState::Hold,
            WorkAction::ClockOut => WorkState::ClockedOut,
            WorkAction::SignOut => WorkState::SignedOut,
            WorkAction::ClockIn => WorkState::Available,
        };
        // Repeated stops and explicit resumes both cancel ALL previous grants.
        state.revision += 1;
        state.updated_at = input.now_secs;
    }
    Ok(WorkTransitionReport {
        accepted,
        revoke_operations: accepted,
        reason: reason.into(),
        notification_disposition: notifications(state.state),
        state,
        simulation: true,
        account_wide_protection: false,
        profile_visible: true,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Sensor {
    Camera,
    Microphone,
    Location,
    Motion,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SensorPurpose {
    Work,
    Authentication,
    Preview,
    Diagnostics,
    Calibration,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkAuthority {
    pub account_id: String,
    pub device_id: String,
    pub operation_id: String,
    pub revision: u64,
    pub issued_at: u64,
    pub expires_at: u64,
    pub purpose: SensorPurpose,
    pub sensors: Vec<Sensor>,
    pub explicit_consent: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CameraExceptionStatus {
    Active,
    Closed,
    Cancelled,
    Expired,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuthenticationCameraException {
    pub account_id: String,
    pub device_id: String,
    pub operation_id: String,
    pub revision: u64,
    pub issued_at: u64,
    pub expires_at: u64,
    pub deliberate: bool,
    pub status: CameraExceptionStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeviceShutdownStatus {
    Stopped,
    Active,
    Pending,
    Unreachable,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeviceShutdownAcknowledgment {
    pub device_id: String,
    pub revision: u64,
    pub status: DeviceShutdownStatus,
    #[serde(default)]
    pub observed_at: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkPrivacyAssessInput {
    pub now_secs: u64,
    pub account_id: String,
    pub device_id: String,
    pub operation_id: String,
    pub sensor: Sensor,
    pub purpose: SensorPurpose,
    #[serde(default)]
    pub state: Option<PrivacyState>,
    #[serde(default)]
    pub authority: Option<WorkAuthority>,
    #[serde(default)]
    pub auth_camera: Option<AuthenticationCameraException>,
    #[serde(default)]
    pub devices: Vec<DeviceShutdownAcknowledgment>,
}

#[derive(Debug, Serialize)]
pub struct WorkPrivacyAssessment {
    pub allowed_for_simulation: bool,
    pub simulation: bool,
    pub account_wide_protection: bool,
    pub reason: String,
    pub notification_disposition: NotificationDisposition,
    pub profile_visible: bool,
    pub shutdown_confirmed_for_simulation: bool,
    pub unconfirmed_devices: Vec<String>,
}

fn valid_window(issued: u64, expires: u64, now: u64, state: &PrivacyState) -> bool {
    issued >= state.updated_at && expires > issued && issued <= now && now < expires
}

pub fn assess(input: WorkPrivacyAssessInput) -> Result<WorkPrivacyAssessment, String> {
    identifier(&input.account_id)?;
    identifier(&input.device_id)?;
    identifier(&input.operation_id)?;
    if input.devices.len() > 256 {
        return Err("Too many simulated device acknowledgments".into());
    }
    let reason = access_reason(&input);
    let work_state = input
        .state
        .as_ref()
        .filter(|state| state.account_id == input.account_id && state.updated_at <= input.now_secs)
        .map(|state| state.state)
        .unwrap_or(WorkState::Unknown);
    let mut unconfirmed = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for device in &input.devices {
        identifier(&device.device_id)?;
        if !seen.insert(&device.device_id) {
            return Err("Duplicate simulated device acknowledgment".into());
        }
        let confirmed = input.state.as_ref().is_some_and(|state| {
            state.account_id == input.account_id
                && state.state != WorkState::Unknown
                && state.state != WorkState::Available
                && device.revision == state.revision
                && device.status == DeviceShutdownStatus::Stopped
                && device
                    .observed_at
                    .is_some_and(|time| time >= state.updated_at && time <= input.now_secs)
        });
        if !confirmed {
            unconfirmed.push(device.device_id.clone());
        }
    }
    Ok(WorkPrivacyAssessment {
        allowed_for_simulation: reason == "work_authority_valid"
            || reason == "authentication_camera_only",
        simulation: true,
        account_wide_protection: false,
        reason: reason.into(),
        notification_disposition: notifications(work_state),
        profile_visible: true,
        shutdown_confirmed_for_simulation: !input.devices.is_empty() && unconfirmed.is_empty(),
        unconfirmed_devices: unconfirmed,
    })
}

fn access_reason(input: &WorkPrivacyAssessInput) -> &'static str {
    let Some(state) = &input.state else {
        return "shared_state_unknown";
    };
    if state.account_id != input.account_id {
        return "account_mismatch";
    }
    if state.state == WorkState::Unknown {
        return "shared_state_unknown";
    }
    if state.updated_at > input.now_secs {
        return "invalid_clock";
    }
    if input.purpose == SensorPurpose::Authentication {
        if input.sensor != Sensor::Camera {
            return "authentication_camera_only_required";
        }
        let Some(camera) = &input.auth_camera else {
            return "authentication_camera_authority_missing";
        };
        if camera.account_id != input.account_id
            || camera.device_id != input.device_id
            || camera.operation_id != input.operation_id
        {
            return "authentication_camera_scope_mismatch";
        }
        if camera.revision != state.revision {
            return "authentication_camera_revoked";
        }
        if !camera.deliberate || camera.status != CameraExceptionStatus::Active {
            return "authentication_camera_inactive";
        }
        if !valid_window(camera.issued_at, camera.expires_at, input.now_secs, state) {
            return "authentication_camera_expired_or_unknown";
        }
        return "authentication_camera_only";
    }
    // Previews, calibration and diagnostics share the same stop boundary.
    if state.state != WorkState::Available {
        return "work_stopped";
    }
    let Some(authority) = &input.authority else {
        return "work_authority_missing";
    };
    if authority.account_id != input.account_id
        || authority.device_id != input.device_id
        || authority.operation_id != input.operation_id
        || authority.purpose != input.purpose
    {
        return "work_authority_scope_mismatch";
    }
    if authority.revision != state.revision {
        return "work_authority_revoked";
    }
    if !valid_window(
        authority.issued_at,
        authority.expires_at,
        input.now_secs,
        state,
    ) {
        return "work_authority_expired_or_unknown";
    }
    if !authority.explicit_consent || !authority.sensors.contains(&input.sensor) {
        return "sensor_consent_missing";
    }
    "work_authority_valid"
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn work_privacy_transition(input_json: &str) -> Result<String, String> {
    serde_json::to_string(&transition(crate::parse(input_json)?)?).map_err(crate::err)
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn work_privacy_assess(input_json: &str) -> Result<String, String> {
    serde_json::to_string(&assess(crate::parse(input_json)?)?).map_err(crate::err)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state(work: WorkState) -> PrivacyState {
        PrivacyState {
            account_id: "account".into(),
            state: work,
            revision: 1,
            updated_at: 100,
        }
    }

    fn command(state: PrivacyState, action: WorkAction, revision: u64) -> WorkTransitionInput {
        WorkTransitionInput {
            now_secs: 110,
            state,
            command: WorkCommand {
                account_id: "account".into(),
                action,
                expected_revision: revision,
                authorized_controller: true,
                deliberate: true,
            },
        }
    }

    fn request(work: WorkState) -> WorkPrivacyAssessInput {
        WorkPrivacyAssessInput {
            now_secs: 110,
            account_id: "account".into(),
            device_id: "device-a".into(),
            operation_id: "operation-a".into(),
            sensor: Sensor::Camera,
            purpose: SensorPurpose::Work,
            state: Some(state(work)),
            authority: Some(WorkAuthority {
                account_id: "account".into(),
                device_id: "device-a".into(),
                operation_id: "operation-a".into(),
                revision: 1,
                issued_at: 100,
                expires_at: 120,
                purpose: SensorPurpose::Work,
                sensors: vec![Sensor::Camera],
                explicit_consent: true,
            }),
            auth_camera: None,
            devices: vec![],
        }
    }

    fn exception() -> AuthenticationCameraException {
        AuthenticationCameraException {
            account_id: "account".into(),
            device_id: "device-a".into(),
            operation_id: "operation-a".into(),
            revision: 1,
            issued_at: 100,
            expires_at: 120,
            deliberate: true,
            status: CameraExceptionStatus::Active,
        }
    }

    #[test]
    fn stopped_and_unknown_block_every_app_sensor_path() {
        for work in [
            WorkState::Unknown,
            WorkState::Hold,
            WorkState::ClockedOut,
            WorkState::SignedOut,
        ] {
            for purpose in [
                SensorPurpose::Work,
                SensorPurpose::Preview,
                SensorPurpose::Diagnostics,
                SensorPurpose::Calibration,
            ] {
                for sensor in [
                    Sensor::Camera,
                    Sensor::Microphone,
                    Sensor::Location,
                    Sensor::Motion,
                    Sensor::Other,
                ] {
                    let mut input = request(work);
                    input.sensor = sensor;
                    input.purpose = purpose;
                    assert!(!assess(input).unwrap().allowed_for_simulation);
                }
            }
        }
        let mut unknown = request(WorkState::Available);
        unknown.state = None;
        assert!(!assess(unknown).unwrap().allowed_for_simulation);
        let output = assess(request(WorkState::Available)).unwrap();
        assert!(output.allowed_for_simulation);
        assert!(!output.account_wide_protection);
        assert!(!output.shutdown_confirmed_for_simulation);
    }

    #[test]
    fn availability_requires_current_scoped_consent_and_exclusive_expiry() {
        for field in [
            "account",
            "device",
            "operation",
            "revision",
            "expiry",
            "future",
            "consent",
            "sensor",
            "purpose",
        ] {
            let mut input = request(WorkState::Available);
            let grant = input.authority.as_mut().unwrap();
            match field {
                "account" => grant.account_id = "other".into(),
                "device" => grant.device_id = "other".into(),
                "operation" => grant.operation_id = "other".into(),
                "revision" => grant.revision = 0,
                "expiry" => input.now_secs = 120,
                "future" => grant.issued_at = 111,
                "consent" => grant.explicit_consent = false,
                "sensor" => input.sensor = Sensor::Location,
                "purpose" => input.purpose = SensorPurpose::Calibration,
                _ => unreachable!(),
            }
            assert!(!assess(input).unwrap().allowed_for_simulation, "{field}");
        }
        let mut absent = request(WorkState::Available);
        absent.authority = None;
        assert!(!assess(absent).unwrap().allowed_for_simulation);
    }

    #[test]
    fn authentication_exception_is_camera_only_deliberate_and_operation_bound() {
        for work in [
            WorkState::Available,
            WorkState::Hold,
            WorkState::ClockedOut,
            WorkState::SignedOut,
        ] {
            let mut input = request(work);
            input.purpose = SensorPurpose::Authentication;
            input.auth_camera = Some(exception());
            assert!(assess(input).unwrap().allowed_for_simulation);
        }
        for field in [
            "device",
            "operation",
            "account",
            "revision",
            "sensor",
            "purpose",
            "deliberate",
            "closed",
            "expiry",
        ] {
            let mut input = request(WorkState::Hold);
            input.purpose = SensorPurpose::Authentication;
            input.auth_camera = Some(exception());
            let camera = input.auth_camera.as_mut().unwrap();
            match field {
                "device" => camera.device_id = "other".into(),
                "operation" => camera.operation_id = "other".into(),
                "account" => camera.account_id = "other".into(),
                "revision" => camera.revision = 0,
                "sensor" => input.sensor = Sensor::Microphone,
                "purpose" => input.purpose = SensorPurpose::Preview,
                "deliberate" => camera.deliberate = false,
                "closed" => camera.status = CameraExceptionStatus::Closed,
                "expiry" => input.now_secs = 120,
                _ => unreachable!(),
            }
            assert!(!assess(input).unwrap().allowed_for_simulation, "{field}");
        }
    }

    #[test]
    fn stale_resume_cannot_undo_a_new_stop_or_resurrect_old_grants() {
        let hold = transition(command(state(WorkState::Available), WorkAction::Hold, 1)).unwrap();
        assert!(hold.accepted);
        assert!(hold.revoke_operations);
        assert_eq!(hold.state.revision, 2);
        let late = transition(command(hold.state.clone(), WorkAction::ClockIn, 1)).unwrap();
        assert!(!late.accepted);
        assert_eq!(late.state.state, WorkState::Hold);
        let resumed = transition(command(hold.state, WorkAction::ClockIn, 2)).unwrap();
        assert!(resumed.accepted);
        assert_eq!(resumed.state.revision, 3);
        let mut input = request(WorkState::Available);
        input.state = Some(resumed.state);
        assert!(!assess(input).unwrap().allowed_for_simulation);
        let mut remote = command(state(WorkState::Hold), WorkAction::ClockIn, 1);
        remote.command.deliberate = false;
        assert!(!transition(remote).unwrap().accepted);
    }

    #[test]
    fn a_deliberate_stop_accepts_an_older_revision_but_resume_needs_the_latest() {
        let clocked_in =
            transition(command(state(WorkState::Hold), WorkAction::ClockIn, 1)).unwrap();
        // The user selected Hold while clock-in's asynchronous decision was pending.
        let stopped = transition(command(clocked_in.state, WorkAction::Hold, 1)).unwrap();
        assert!(stopped.accepted);
        assert_eq!(stopped.state.state, WorkState::Hold);
        assert_eq!(stopped.state.revision, 3);
        assert!(stopped.revoke_operations);
        let future = transition(command(stopped.state.clone(), WorkAction::ClockOut, 4)).unwrap();
        assert!(!future.accepted);
        let stale_resume = transition(command(stopped.state, WorkAction::ClockIn, 2)).unwrap();
        assert!(!stale_resume.accepted);
    }

    #[test]
    fn hold_keeps_notifications_profiles_survive_every_state() {
        for (work, expected) in [
            (WorkState::Available, NotificationDisposition::Normal),
            (WorkState::Hold, NotificationDisposition::Normal),
            (WorkState::ClockedOut, NotificationDisposition::Silent),
            (WorkState::SignedOut, NotificationDisposition::Silent),
            (WorkState::Unknown, NotificationDisposition::Silent),
        ] {
            let output = assess(request(work)).unwrap();
            assert_eq!(output.notification_disposition, expected);
            assert!(output.profile_visible);
        }
    }

    #[test]
    fn shutdown_requires_observed_current_acknowledgments_never_lease_expiry() {
        let ack = DeviceShutdownAcknowledgment {
            device_id: "device-a".into(),
            revision: 1,
            status: DeviceShutdownStatus::Stopped,
            observed_at: Some(105),
        };
        let mut input = request(WorkState::Hold);
        input.devices = vec![ack.clone()];
        let confirmed = assess(input).unwrap();
        assert!(confirmed.shutdown_confirmed_for_simulation);
        assert!(!confirmed.account_wide_protection);
        for status in [
            DeviceShutdownStatus::Unreachable,
            DeviceShutdownStatus::Failed,
            DeviceShutdownStatus::Pending,
            DeviceShutdownStatus::Active,
        ] {
            let mut input = request(WorkState::Hold);
            input.now_secs = 200; // Expiry is not an observed shutdown.
            let mut remote = ack.clone();
            remote.device_id = "device-b".into();
            remote.status = status;
            input.devices = vec![ack.clone(), remote];
            let report = assess(input).unwrap();
            assert!(!report.shutdown_confirmed_for_simulation);
            assert_eq!(report.unconfirmed_devices, vec!["device-b"]);
        }
        for observed in [None, Some(99), Some(111)] {
            let mut input = request(WorkState::Hold);
            let mut stale = ack.clone();
            stale.observed_at = observed;
            input.devices = vec![stale];
            assert!(!assess(input).unwrap().shutdown_confirmed_for_simulation);
        }
    }
}
