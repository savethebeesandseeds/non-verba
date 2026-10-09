// SPDX-License-Identifier: AGPL-3.0-only
//! Isolated local registration drafts for Operator and Requester development.
//!
//! Draft completeness and deliberate review do not verify identity, ownership of
//! an email address, qualifications, signing authority or authentication. This
//! module neither creates an account nor stores, publishes or sends any data.
//! Optional accessibility information is functional support information, not a
//! requirement to disclose a diagnosis, disability proof or medical history.

use crate::face_identity::{FaceModelSpec, FaceReference};
use serde::{Deserialize, Serialize};

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

pub const MAX_CERTIFICATIONS: usize = 16;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RegistrationRole {
    Operator,
    Requester,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PersonalDetails {
    pub display_name: String,
    pub contact_email: String,
    #[serde(default)]
    pub legal_name: String,
    #[serde(default)]
    pub organization: String,
    #[serde(default)]
    pub country: String,
    #[serde(default)]
    pub preferred_language: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AccommodationDetails {
    #[serde(default)]
    pub note: String,
    /// A future preference only; no counterparty or disclosure is authorized.
    #[serde(default)]
    pub share_with_task_counterparty: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CertificationDetails {
    pub title: String,
    #[serde(default)]
    pub issuer: String,
    #[serde(default)]
    pub reference: String,
    #[serde(default)]
    pub issued_on: String,
    #[serde(default)]
    pub expires_on: String,
    /// A future preference, separate from publication and qualification checks.
    #[serde(default)]
    pub share_with_task_counterparty: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RegistrationAcknowledgments {
    #[serde(default)]
    pub private_data_handling: bool,
    #[serde(default)]
    pub self_reported_certifications: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PublicSharingPreferences {
    #[serde(default)]
    pub publish_display_name: bool,
    #[serde(default)]
    pub publish_organization: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RegistrationDraft {
    pub role: RegistrationRole,
    /// Only a local review freshness counter. It carries no external authority.
    pub revision: u32,
    pub personal: PersonalDetails,
    #[serde(default)]
    pub accommodations: AccommodationDetails,
    #[serde(default)]
    pub certifications: Vec<CertificationDetails>,
    #[serde(default)]
    pub acknowledgments: RegistrationAcknowledgments,
    #[serde(default)]
    pub sharing: PublicSharingPreferences,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RegistrationInput {
    pub draft: RegistrationDraft,
    #[serde(default)]
    pub reviewed_revision: Option<u32>,
    #[serde(default)]
    pub deliberate: bool,
    /// Selected only by the Operator inspection pipeline; not a universal gate.
    #[serde(default)]
    pub face_policy: Option<RegistrationFacePolicy>,
    #[serde(default)]
    pub face_reference: Option<FaceReference>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RegistrationFacePolicy {
    pub required: bool,
    pub account_id: String,
    pub principal_id: String,
    pub model: FaceModelSpec,
}

#[derive(Debug, Clone, Serialize)]
pub struct FaceEnrollmentSummary {
    pub reference_id: String,
    pub account_id: String,
    pub principal_id: String,
    pub model: FaceModelSpec,
    pub enrolled_at: u64,
    pub simulation: bool,
    pub enrollment_continuity_only: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct FieldError {
    /// Dot path relative to the draft, without repeating submitted private data.
    pub field: String,
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PreparedCertification {
    #[serde(flatten)]
    pub details: CertificationDetails,
    pub verification: &'static str,
}

#[derive(Debug, Clone, Serialize)]
pub struct PrivateRegistrationDetails {
    pub personal: PersonalDetails,
    pub accommodations: AccommodationDetails,
    pub certifications: Vec<PreparedCertification>,
    /// Private reference metadata only: no vector or facial media in the draft record.
    pub face_enrollment: Option<FaceEnrollmentSummary>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RegistrationSharingPreferences {
    pub publish_display_name: bool,
    pub publish_organization: bool,
    pub share_accommodations_with_task_counterparty: bool,
    pub share_certifications_with_task_counterparty: Vec<bool>,
}

/// An explicit allowlist rather than a redacted copy of private details.
#[derive(Debug, Clone, Serialize)]
pub struct PublicProfileCandidate {
    pub display_name: Option<String>,
    pub organization: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PreparedLocalRegistration {
    pub role: RegistrationRole,
    pub revision: u32,
    pub private_details: PrivateRegistrationDetails,
    pub acknowledgments: RegistrationAcknowledgments,
    pub sharing_preferences: RegistrationSharingPreferences,
    pub public_candidate: PublicProfileCandidate,
    pub identity_verification: &'static str,
    pub certification_verification: &'static str,
}

#[derive(Debug, Clone, Serialize)]
pub struct RegistrationReport {
    pub valid_draft: bool,
    pub review_current: bool,
    pub ready_for_local_prepare: bool,
    pub prepared: bool,
    pub errors: Vec<FieldError>,
    pub reason: &'static str,
    pub record: Option<PreparedLocalRegistration>,
    pub simulation: bool,
    pub account_created: bool,
    pub authenticated: bool,
    pub identity_verified: bool,
    pub certifications_verified: bool,
    pub publication_performed: bool,
    pub data_transmitted: bool,
    pub sensors_requested: bool,
}

fn field_error(errors: &mut Vec<FieldError>, field: &str, code: &str, message: &str) {
    errors.push(FieldError {
        field: field.into(),
        code: code.into(),
        message: message.into(),
    });
}

fn check_text(
    errors: &mut Vec<FieldError>,
    field: &str,
    value: &str,
    max_bytes: usize,
    required: bool,
    multiline: bool,
) {
    if required && value.trim().is_empty() {
        field_error(errors, field, "required", "Provide a value for this field.");
    }
    if value.len() > max_bytes {
        field_error(
            errors,
            field,
            "too_long",
            "This field exceeds its allowed length.",
        );
    }
    if value.chars().any(|character| {
        character.is_control() && !(multiline && matches!(character, '\n' | '\r' | '\t'))
    }) {
        field_error(
            errors,
            field,
            "control_character",
            "Remove unsupported control characters.",
        );
    }
}

fn email_shape(value: &str) -> bool {
    // Shape guidance only. No delivery, ownership or external identity check.
    let value = value.trim();
    let Some((local, domain)) = value.split_once('@') else {
        return false;
    };
    !local.is_empty()
        && local.len() <= 64
        && !domain.is_empty()
        && !domain.contains('@')
        && !value
            .chars()
            .any(|character| character.is_whitespace() || character.is_control())
        && domain.split('.').all(|part| {
            !part.is_empty()
                && !part.starts_with('-')
                && !part.ends_with('-')
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        })
        && !local
            .chars()
            .any(|character| matches!(character, '<' | '>' | ',' | ';'))
}

fn date_shape(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 10
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes
            .iter()
            .enumerate()
            .any(|(index, byte)| index != 4 && index != 7 && !byte.is_ascii_digit())
    {
        return false;
    }
    let year = value[..4].parse::<u32>().unwrap_or(0);
    let month = value[5..7].parse::<u32>().unwrap_or(0);
    let day = value[8..].parse::<u32>().unwrap_or(0);
    let maximum = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        2 => 28,
        _ => 0,
    };
    year > 0 && day > 0 && day <= maximum
}

pub fn validate(draft: &RegistrationDraft) -> Vec<FieldError> {
    let mut errors = Vec::new();
    let personal = &draft.personal;
    for (field, value, maximum, required) in [
        (
            "personal.display_name",
            personal.display_name.as_str(),
            120,
            true,
        ),
        (
            "personal.contact_email",
            personal.contact_email.as_str(),
            254,
            true,
        ),
        (
            "personal.legal_name",
            personal.legal_name.as_str(),
            200,
            false,
        ),
        (
            "personal.organization",
            personal.organization.as_str(),
            200,
            false,
        ),
        ("personal.country", personal.country.as_str(), 80, false),
        (
            "personal.preferred_language",
            personal.preferred_language.as_str(),
            80,
            false,
        ),
    ] {
        check_text(&mut errors, field, value, maximum, required, false);
    }
    if !personal.contact_email.trim().is_empty() && !email_shape(&personal.contact_email) {
        field_error(
            &mut errors,
            "personal.contact_email",
            "email_shape",
            "Enter an email address such as name@example.test.",
        );
    }
    check_text(
        &mut errors,
        "accommodations.note",
        &draft.accommodations.note,
        2000,
        false,
        true,
    );
    if draft.accommodations.share_with_task_counterparty
        && draft.accommodations.note.trim().is_empty()
    {
        field_error(
            &mut errors,
            "accommodations.share_with_task_counterparty",
            "no_information_to_share",
            "Provide support information or leave this optional sharing preference off.",
        );
    }
    if draft.certifications.len() > MAX_CERTIFICATIONS {
        field_error(
            &mut errors,
            "certifications",
            "too_many",
            "A draft may contain at most 16 certifications.",
        );
    }
    // Bound traversal even for an oversized imported draft.
    for (index, certification) in draft
        .certifications
        .iter()
        .take(MAX_CERTIFICATIONS)
        .enumerate()
    {
        let prefix = format!("certifications.{index}");
        for (suffix, value, maximum, required) in [
            ("title", certification.title.as_str(), 160, true),
            ("issuer", certification.issuer.as_str(), 200, false),
            ("reference", certification.reference.as_str(), 200, false),
            ("issued_on", certification.issued_on.as_str(), 10, false),
            ("expires_on", certification.expires_on.as_str(), 10, false),
        ] {
            check_text(
                &mut errors,
                &format!("{prefix}.{suffix}"),
                value,
                maximum,
                required,
                false,
            );
        }
        for (suffix, value) in [
            ("issued_on", &certification.issued_on),
            ("expires_on", &certification.expires_on),
        ] {
            if !value.is_empty() && !date_shape(value) {
                field_error(
                    &mut errors,
                    &format!("{prefix}.{suffix}"),
                    "date_shape",
                    "Use a valid date in YYYY-MM-DD format or leave it empty.",
                );
            }
        }
        if date_shape(&certification.issued_on)
            && date_shape(&certification.expires_on)
            && certification.expires_on < certification.issued_on
        {
            field_error(
                &mut errors,
                &format!("{prefix}.expires_on"),
                "date_order",
                "Expiry cannot precede the stated issue date.",
            );
        }
    }
    if !draft.acknowledgments.private_data_handling {
        field_error(
            &mut errors,
            "acknowledgments.private_data_handling",
            "acknowledgment_required",
            "Acknowledge the private handling of this local registration information.",
        );
    }
    if !draft.certifications.is_empty() && !draft.acknowledgments.self_reported_certifications {
        field_error(
            &mut errors,
            "acknowledgments.self_reported_certifications",
            "acknowledgment_required",
            "Acknowledge that these certifications are self-reported and unverified.",
        );
    }
    if draft.sharing.publish_organization && personal.organization.trim().is_empty() {
        field_error(
            &mut errors,
            "sharing.publish_organization",
            "no_information_to_share",
            "Provide an organization or leave this optional publication preference off.",
        );
    }
    errors
}

fn local_record(
    draft: RegistrationDraft,
    face: Option<FaceEnrollmentSummary>,
) -> PreparedLocalRegistration {
    let public_candidate = PublicProfileCandidate {
        display_name: draft
            .sharing
            .publish_display_name
            .then(|| draft.personal.display_name.clone()),
        organization: draft
            .sharing
            .publish_organization
            .then(|| draft.personal.organization.clone()),
    };
    let sharing_preferences = RegistrationSharingPreferences {
        publish_display_name: draft.sharing.publish_display_name,
        publish_organization: draft.sharing.publish_organization,
        share_accommodations_with_task_counterparty: draft
            .accommodations
            .share_with_task_counterparty,
        share_certifications_with_task_counterparty: draft
            .certifications
            .iter()
            .map(|certification| certification.share_with_task_counterparty)
            .collect(),
    };
    PreparedLocalRegistration {
        role: draft.role,
        revision: draft.revision,
        private_details: PrivateRegistrationDetails {
            personal: draft.personal,
            accommodations: draft.accommodations,
            certifications: draft
                .certifications
                .into_iter()
                .map(|details| PreparedCertification {
                    details,
                    verification: "self_reported_unverified",
                })
                .collect(),
            face_enrollment: face,
        },
        acknowledgments: draft.acknowledgments,
        sharing_preferences,
        public_candidate,
        identity_verification: "not_implemented",
        certification_verification: "self_reported_unverified",
    }
}

fn evaluate(input: RegistrationInput, prepare: bool) -> RegistrationReport {
    let mut errors = validate(&input.draft);
    let face = registration_face(&input, &mut errors);
    let valid_draft = errors.is_empty();
    let review_current = input.reviewed_revision == Some(input.draft.revision);
    let ready_for_local_prepare = valid_draft && review_current;
    let prepared = prepare && ready_for_local_prepare && input.deliberate;
    let reason = if !valid_draft {
        "invalid_draft"
    } else if input.reviewed_revision.is_none() {
        "review_required"
    } else if !review_current {
        "review_stale"
    } else if prepare && !input.deliberate {
        "deliberate_preparation_required"
    } else if prepared {
        "local_registration_prepared"
    } else {
        "ready_for_local_prepare"
    };
    RegistrationReport {
        valid_draft,
        review_current,
        ready_for_local_prepare,
        prepared,
        errors,
        reason,
        record: prepared.then(|| local_record(input.draft, face)),
        simulation: true,
        account_created: false,
        authenticated: false,
        identity_verified: false,
        certifications_verified: false,
        publication_performed: false,
        data_transmitted: false,
        sensors_requested: false,
    }
}

fn registration_face(
    input: &RegistrationInput,
    errors: &mut Vec<FieldError>,
) -> Option<FaceEnrollmentSummary> {
    if input.draft.role == RegistrationRole::Requester {
        if input
            .face_policy
            .as_ref()
            .is_some_and(|policy| policy.required)
            || input.face_reference.is_some()
        {
            field_error(
                errors,
                "face_policy",
                "operator_only",
                "Requester registration has no face enrollment requirement.",
            );
        }
        return None;
    }
    let Some(policy) = &input.face_policy else {
        if input.face_reference.is_some() {
            field_error(
                errors,
                "face_reference",
                "policy_required",
                "Select the Operator face enrollment policy before using a reference.",
            );
        }
        return None;
    };
    if crate::authentication::identifier(&policy.account_id).is_err()
        || crate::authentication::identifier(&policy.principal_id).is_err()
        || !policy.model.is_selected()
    {
        field_error(
            errors,
            "face_policy",
            "selected_model_required",
            "The enrollment policy needs a bound account and the pinned selected model.",
        );
        return None;
    }
    let Some(reference) = &input.face_reference else {
        if policy.required {
            field_error(
                errors,
                "face_reference",
                "enrollment_missing",
                "Enroll an Operator reference before preparing this selected pipeline.",
            );
        }
        return None;
    };
    if !reference.valid_for(&policy.account_id, &policy.principal_id, &policy.model) {
        field_error(errors, "face_reference", "invalid_reference", "The face reference must match this account, principal and exact selected model pipeline.");
        return None;
    }
    Some(FaceEnrollmentSummary {
        reference_id: reference.reference_id.clone(),
        account_id: reference.account_id.clone(),
        principal_id: reference.principal_id.clone(),
        model: reference.model.clone(),
        enrolled_at: reference.enrolled_at,
        simulation: reference.simulation,
        enrollment_continuity_only: true,
    })
}

pub fn assess(input: RegistrationInput) -> RegistrationReport {
    evaluate(input, false)
}
pub fn prepare(input: RegistrationInput) -> RegistrationReport {
    evaluate(input, true)
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn registration_assess(input_json: &str) -> Result<String, String> {
    serde_json::to_string(&assess(crate::parse(input_json)?)).map_err(crate::err)
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn registration_prepare(input_json: &str) -> Result<String, String> {
    serde_json::to_string(&prepare(crate::parse(input_json)?)).map_err(crate::err)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn draft(role: RegistrationRole) -> RegistrationDraft {
        RegistrationDraft {
            role,
            revision: 1,
            personal: PersonalDetails {
                display_name: "Local Person".into(),
                contact_email: "person@example.test".into(),
                legal_name: String::new(),
                organization: String::new(),
                country: String::new(),
                preferred_language: String::new(),
            },
            accommodations: AccommodationDetails::default(),
            certifications: vec![],
            acknowledgments: RegistrationAcknowledgments {
                private_data_handling: true,
                self_reported_certifications: false,
            },
            sharing: PublicSharingPreferences::default(),
        }
    }

    fn input(draft: RegistrationDraft) -> RegistrationInput {
        RegistrationInput {
            reviewed_revision: Some(draft.revision),
            draft,
            deliberate: true,
            face_policy: None,
            face_reference: None,
        }
    }

    fn certification() -> CertificationDetails {
        CertificationDetails {
            title: "Self-reported training".into(),
            issuer: "Declared issuer".into(),
            reference: "private reference".into(),
            issued_on: "2024-02-29".into(),
            expires_on: "2027-03-01".into(),
            share_with_task_counterparty: false,
        }
    }

    #[test]
    fn both_roles_can_prepare_without_optional_sensitive_or_qualification_details() {
        for role in [RegistrationRole::Operator, RegistrationRole::Requester] {
            let report = prepare(input(draft(role)));
            assert!(report.prepared);
            assert!(report.errors.is_empty());
            assert!(!report.account_created && !report.authenticated && !report.identity_verified);
            assert!(!report.certifications_verified && !report.publication_performed);
            assert!(!report.data_transmitted && !report.sensors_requested);
            let record = report.record.unwrap();
            assert_eq!(record.role, role);
            assert_eq!(record.identity_verification, "not_implemented");
            assert_eq!(record.public_candidate.display_name, None);
            assert_eq!(record.public_candidate.organization, None);
        }
    }

    #[test]
    fn selected_operator_enrollment_is_required_bound_and_never_in_the_public_candidate() {
        let mut input = input(draft(RegistrationRole::Operator));
        input.face_policy = Some(RegistrationFacePolicy {
            required: true,
            account_id: "account".into(),
            principal_id: "person".into(),
            model: crate::face_identity::selected_model(),
        });
        let missing = prepare(input.clone());
        assert!(!missing.prepared);
        assert!(missing
            .errors
            .iter()
            .any(|error| error.code == "enrollment_missing"));
        input.face_reference = Some(crate::face_identity::fixture_reference(false));
        let prepared = prepare(input.clone());
        assert!(prepared.prepared);
        assert!(!prepared.identity_verified && !prepared.authenticated);
        let record = prepared.record.unwrap();
        assert!(record.private_details.face_enrollment.is_some());
        let summary = serde_json::to_string(&record.private_details.face_enrollment).unwrap();
        assert!(!summary.contains("embedding"));
        let public = serde_json::to_string(&record.public_candidate).unwrap();
        assert!(
            !public.contains("face") && !public.contains("reference") && !public.contains("model")
        );
        input.face_reference.as_mut().unwrap().principal_id = "other-person".into();
        assert!(!prepare(input.clone()).prepared);
        input.draft.role = RegistrationRole::Requester;
        let requester = prepare(input);
        assert!(!requester.prepared);
        assert!(requester
            .errors
            .iter()
            .any(|error| error.code == "operator_only"));
    }

    #[test]
    fn review_and_deliberate_preparation_are_distinct_and_edits_invalidate_review() {
        let initial = input(draft(RegistrationRole::Operator));
        assert!(!assess(initial.clone()).prepared);
        let mut no_review = initial.clone();
        no_review.reviewed_revision = None;
        assert_eq!(prepare(no_review).reason, "review_required");
        let mut edit = initial.clone();
        edit.draft.revision += 1;
        let stale = prepare(edit);
        assert!(!stale.prepared && stale.record.is_none());
        assert_eq!(stale.reason, "review_stale");
        let mut not_deliberate = initial;
        not_deliberate.deliberate = false;
        assert_eq!(
            prepare(not_deliberate).reason,
            "deliberate_preparation_required"
        );
    }

    #[test]
    fn acknowledgments_do_not_enable_optional_sharing_or_verify_certifications() {
        let mut draft = draft(RegistrationRole::Operator);
        draft.certifications.push(certification());
        let missing = prepare(input(draft.clone()));
        assert!(missing
            .errors
            .iter()
            .any(|error| error.field == "acknowledgments.self_reported_certifications"));
        draft.acknowledgments.self_reported_certifications = true;
        let report = prepare(input(draft));
        assert!(report.prepared);
        assert!(!report.certifications_verified);
        let record = report.record.unwrap();
        assert_eq!(
            record.private_details.certifications[0].verification,
            "self_reported_unverified"
        );
        assert!(!record.sharing_preferences.publish_display_name);
        assert!(
            !record
                .sharing_preferences
                .share_certifications_with_task_counterparty[0]
        );
    }

    #[test]
    fn public_candidate_allowlist_excludes_private_details_even_with_every_sharing_opt_in() {
        let mut draft = draft(RegistrationRole::Requester);
        draft.personal.legal_name = "Private Legal Name".into();
        draft.personal.organization = "Chosen Public Organization".into();
        draft.accommodations.note = "Private accessibility support note".into();
        draft.accommodations.share_with_task_counterparty = true;
        let mut claim = certification();
        claim.share_with_task_counterparty = true;
        draft.certifications.push(claim);
        draft.acknowledgments.self_reported_certifications = true;
        draft.sharing.publish_display_name = true;
        draft.sharing.publish_organization = true;
        let report = prepare(input(draft));
        assert!(!report.publication_performed && !report.data_transmitted);
        let projection = serde_json::to_value(report.record.unwrap().public_candidate).unwrap();
        assert_eq!(projection.as_object().unwrap().len(), 2);
        let bytes = projection.to_string();
        assert!(!bytes.contains("Private Legal") && !bytes.contains("accessibility"));
        assert!(!bytes.contains("contact_email") && !bytes.contains("reference"));
    }

    #[test]
    fn field_errors_bound_values_counts_and_dates_without_echoing_private_values() {
        let mut draft = draft(RegistrationRole::Operator);
        draft.personal.display_name.clear();
        draft.personal.contact_email = "private-invalid-address".into();
        draft.personal.country = "x".repeat(81);
        draft.accommodations.note = "x".repeat(2001);
        draft.certifications = vec![certification(); MAX_CERTIFICATIONS + 1];
        draft.certifications[0].issued_on = "2025-02-29".into();
        draft.certifications[1].expires_on = "2020-01-01".into();
        draft.certifications[2].title = "invalid\0control".into();
        let report = prepare(input(draft));
        assert!(!report.prepared && report.record.is_none());
        for field in [
            "personal.display_name",
            "personal.contact_email",
            "personal.country",
            "accommodations.note",
            "certifications",
            "certifications.0.issued_on",
            "certifications.1.expires_on",
            "certifications.2.title",
        ] {
            assert!(
                report.errors.iter().any(|error| error.field == field),
                "{field}"
            );
        }
        assert!(!serde_json::to_string(&report.errors)
            .unwrap()
            .contains("private-invalid-address"));
        assert!(date_shape("2000-02-29"));
        assert!(!date_shape("1900-02-29"));
        assert!(!date_shape("2025-04-31"));
    }

    #[test]
    fn strict_imports_reject_unknown_roles_and_purported_verification_claims() {
        let base = serde_json::to_value(draft(RegistrationRole::Operator)).unwrap();
        let mut bad_role = base.clone();
        bad_role["role"] = serde_json::json!("administrator");
        assert!(serde_json::from_value::<RegistrationDraft>(bad_role).is_err());
        let mut forged_identity = base.clone();
        forged_identity["identity_verified"] = serde_json::json!(true);
        assert!(serde_json::from_value::<RegistrationDraft>(forged_identity).is_err());
        let mut forged_certification = base;
        let mut claim = serde_json::to_value(certification()).unwrap();
        claim["verification"] = serde_json::json!("verified");
        forged_certification["certifications"] = serde_json::json!([claim]);
        assert!(serde_json::from_value::<RegistrationDraft>(forged_certification).is_err());
    }
}
