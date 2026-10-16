// SPDX-License-Identifier: AGPL-3.0-only
//! Camera-set profile and unsigned preparation/clock-claim assessment.
//! No acquisition, signature, consent, receipt or acceptance is established here.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

pub const MAX_CAMERAS: usize = 16;
pub const MAX_CONCURRENT_SETS: usize = 64;
pub const MAX_PROFILE_BYTES: usize = 16 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LensFacing {
    Front,
    Back,
    External,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CameraDescriptor {
    pub camera_id: String,
    pub lens_facing: LensFacing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CameraSetKind {
    SingleCamera,
    FrontBack,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "kebab-case", deny_unknown_fields)]
pub enum CaptureTiming {
    Single {},
    Concurrent {
        max_start_skew_ns: String,
    },
    /// Explicit ordered acquisition, never a fallback from concurrent capture.
    /// Camera list order is the requested order; no simultaneity tolerance.
    Sequential {},
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CameraSetProfile {
    pub version: u32,
    pub kind: CameraSetKind,
    pub cameras: Vec<CameraDescriptor>,
    pub timing: CaptureTiming,
}

fn identifier(value: &str) -> Result<(), String> {
    if value.trim().is_empty() || value.len() > 128 || value.chars().any(char::is_control) {
        return Err("Camera/clock identifiers require 1 to 128 nonblank, noncontrol bytes".into());
    }
    Ok(())
}

fn counter(value: &str) -> Result<u64, String> {
    if value.is_empty()
        || value.len() > 20
        || !value.bytes().all(|byte| byte.is_ascii_digit())
        || (value.len() > 1 && value.starts_with('0'))
    {
        return Err("Camera-set counters must be canonical unsigned decimal strings".into());
    }
    value
        .parse()
        .map_err(|_| "Camera-set counter exceeds u64".into())
}

fn camera_map(cameras: &[CameraDescriptor]) -> Result<BTreeMap<&str, LensFacing>, String> {
    if cameras.len() > MAX_CAMERAS {
        return Err("Camera-set inventory exceeds the bounded format limit".into());
    }
    let mut result = BTreeMap::new();
    for camera in cameras {
        identifier(&camera.camera_id)?;
        if result
            .insert(camera.camera_id.as_str(), camera.lens_facing)
            .is_some()
        {
            return Err("Duplicate camera identifier".into());
        }
    }
    Ok(result)
}

impl CameraSetProfile {
    pub fn validate(&self) -> Result<(), String> {
        if self.version != 1 || self.cameras.is_empty() {
            return Err(
                "Camera-set profiles require version 1 and an explicit nonempty set".into(),
            );
        }
        camera_map(&self.cameras)?;
        match (&self.kind, &self.timing) {
            (CameraSetKind::SingleCamera, CaptureTiming::Single {}) if self.cameras.len() == 1 => {
                Ok(())
            }
            (CameraSetKind::FrontBack, timing)
                if self
                    .cameras
                    .iter()
                    .any(|camera| camera.lens_facing == LensFacing::Front)
                    && self
                        .cameras
                        .iter()
                        .any(|camera| camera.lens_facing == LensFacing::Back) =>
            {
                match timing {
                    CaptureTiming::Concurrent { max_start_skew_ns } => {
                        counter(max_start_skew_ns)?;
                        Ok(())
                    }
                    CaptureTiming::Sequential {} => Ok(()),
                    _ => Err("Front/back requires explicit concurrent or sequential timing".into()),
                }
            }
            _ => Err("Camera-set kind, required facings, camera count and timing disagree".into()),
        }
    }
}

pub fn parse_profile(json: &str) -> Result<CameraSetProfile, String> {
    if json.len() > MAX_PROFILE_BYTES {
        return Err("Camera-set profile exceeds its input bound".into());
    }
    let profile: CameraSetProfile =
        serde_json::from_str(json).map_err(|error| error.to_string())?;
    profile.validate()?;
    Ok(profile)
}

/// Supplied adapter claims, not attestation or permission to open a camera.
/// None means discovery is unavailable; Some([]) means no combination advertised.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CameraSetCapabilities {
    pub cameras: Vec<CameraDescriptor>,
    pub concurrent_sets: Option<Vec<Vec<String>>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ConcurrencyAdvertisement {
    NotRequired,
    Advertised,
    NotAdvertised,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CapabilityAssessment {
    pub missing_camera_ids: Vec<String>,
    pub facing_mismatch_ids: Vec<String>,
    pub concurrency: ConcurrencyAdvertisement,
}

pub fn assess_capabilities(
    profile: &CameraSetProfile,
    capabilities: &CameraSetCapabilities,
) -> Result<CapabilityAssessment, String> {
    profile.validate()?;
    let available = camera_map(&capabilities.cameras)?;
    let mut combinations = BTreeSet::new();
    if let Some(groups) = &capabilities.concurrent_sets {
        if groups.len() > MAX_CONCURRENT_SETS {
            return Err("Too many advertised concurrent camera sets".into());
        }
        for group in groups {
            let unique: BTreeSet<_> = group.iter().map(String::as_str).collect();
            if unique.len() != group.len()
                || !(2..=MAX_CAMERAS).contains(&group.len())
                || unique.iter().any(|id| !available.contains_key(id))
                || !combinations.insert(unique)
            {
                return Err("Invalid or duplicate advertised concurrent camera set".into());
            }
        }
    }
    let mut missing_camera_ids = Vec::new();
    let mut facing_mismatch_ids = Vec::new();
    for camera in &profile.cameras {
        match available.get(camera.camera_id.as_str()) {
            None => missing_camera_ids.push(camera.camera_id.clone()),
            Some(facing) if *facing != camera.lens_facing => {
                facing_mismatch_ids.push(camera.camera_id.clone());
            }
            Some(_) => {}
        }
    }
    let concurrency = match (&profile.timing, &capabilities.concurrent_sets) {
        (CaptureTiming::Single {} | CaptureTiming::Sequential {}, _) => {
            ConcurrencyAdvertisement::NotRequired
        }
        (_, None) => ConcurrencyAdvertisement::Unknown,
        (_, Some(_)) => {
            if combinations.iter().any(|group| {
                profile
                    .cameras
                    .iter()
                    .all(|camera| group.contains(camera.camera_id.as_str()))
            }) {
                ConcurrencyAdvertisement::Advertised
            } else {
                ConcurrencyAdvertisement::NotAdvertised
            }
        }
    };
    Ok(CapabilityAssessment {
        missing_camera_ids,
        facing_mismatch_ids,
        concurrency,
    })
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CaptureStart {
    pub camera_id: String,
    pub timebase_id: Option<String>,
    pub start_ns: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TimingAssessment {
    NotRequired,
    WithinRequestedSkew,
    ExceedsRequestedSkew,
    SequentialOrderConfirmed,
    SequentialOrderViolated,
    Unassessable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TimingReport {
    pub assessment: TimingAssessment,
    /// Exact max-minus-min exposure starts on one comparable clock. Not callback delay.
    pub exposure_start_span_ns: Option<String>,
}

/// Arithmetic on supplied exposure-start claims; no physical simultaneity proof.
/// Callback receipt times must not be supplied as exposure starts.
pub fn assess_timing(
    profile: &CameraSetProfile,
    starts: &[CaptureStart],
) -> Result<TimingAssessment, String> {
    Ok(assess_timing_report(profile, starts)?.assessment)
}

pub fn assess_timing_report(
    profile: &CameraSetProfile,
    starts: &[CaptureStart],
) -> Result<TimingReport, String> {
    profile.validate()?;
    let expected = camera_map(&profile.cameras)?;
    if starts.len() > expected.len() {
        return Err("More capture starts than required cameras".into());
    }
    let mut observed = BTreeSet::new();
    let mut comparable = true;
    let mut common_timebase: Option<&str> = None;
    let mut times = BTreeMap::new();
    for start in starts {
        if !expected.contains_key(start.camera_id.as_str()) || !observed.insert(&start.camera_id) {
            return Err("Unexpected or duplicate capture-start camera".into());
        }
        if let Some(timebase) = &start.timebase_id {
            identifier(timebase)?;
        }
        let time = start.start_ns.as_deref().map(counter).transpose()?;
        match (start.timebase_id.as_deref(), time) {
            (Some(timebase), Some(time)) => {
                if common_timebase.is_some_and(|previous| previous != timebase) {
                    comparable = false;
                }
                common_timebase = Some(timebase);
                times.insert(start.camera_id.as_str(), time);
            }
            _ => comparable = false,
        }
    }
    let unknown = TimingReport {
        assessment: TimingAssessment::Unassessable,
        exposure_start_span_ns: None,
    };
    if starts.len() != expected.len() {
        return Ok(unknown);
    }
    if matches!(profile.timing, CaptureTiming::Single {}) {
        return Ok(TimingReport {
            assessment: TimingAssessment::NotRequired,
            exposure_start_span_ns: None,
        });
    }
    if !comparable {
        return Ok(unknown);
    }
    let span = times.values().max().unwrap() - times.values().min().unwrap();
    let assessment =
        match &profile.timing {
            CaptureTiming::Concurrent { max_start_skew_ns } => {
                if span <= counter(max_start_skew_ns)? {
                    TimingAssessment::WithinRequestedSkew
                } else {
                    TimingAssessment::ExceedsRequestedSkew
                }
            }
            CaptureTiming::Sequential {} => {
                if profile.cameras.windows(2).all(|pair| {
                    times[pair[0].camera_id.as_str()] < times[pair[1].camera_id.as_str()]
                }) {
                    TimingAssessment::SequentialOrderConfirmed
                } else {
                    TimingAssessment::SequentialOrderViolated
                }
            }
            CaptureTiming::Single {} => unreachable!(),
        };
    Ok(TimingReport {
        assessment,
        exposure_start_span_ns: Some(span.to_string()),
    })
}

#[cfg(test)]
#[path = "camera_set_tests.rs"]
mod tests;
