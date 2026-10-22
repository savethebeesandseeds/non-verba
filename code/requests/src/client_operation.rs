// SPDX-License-Identifier: AGPL-3.0-only
//! Transport-independent bookkeeping for one exact client operation.
//!
//! This is a local model, not an HTTP or receipt wire schema. The adapter must
//! authenticate the service observation and obtain the current principal/key
//! context independently. Matching an observation here proves neither its
//! provenance nor protocol, contractual or physical acceptance. Retrieved
//! originals still need independent verification with the existing verifier.
//!
//! Before calling [`TrackedOperation::begin_dispatch`], the host must durably
//! journal the operation ID, context, binding, exact body and dispatch intent.
//! This in-memory core cannot prove persistence, prevent another process from
//! submitting, or preserve its guard after reconstruction/restart. It performs
//! no I/O, signing, random ID generation, automatic retry or sensor activation.
//! An uncertain result requires read-only lookup; even `NotFound` grants no
//! permission to resend while retention/idempotency semantics remain unresolved.

/// SHA-256 of exact raw bytes, shared with protocol encoding.
/// This does not canonicalize a protocol object.
pub use crate::encoding::bytes_digest;
use crate::encoding::{MAX_JSON_BYTES, validate_digest, validate_id};
use std::{collections::BTreeMap, fmt};

/// Initial opaque-body budget for this client core, not a backend upload limit.
/// Bodies need not be JSON; their bytes are never parsed or reserialized here.
pub const MAX_OPERATION_BODY_BYTES: usize = MAX_JSON_BYTES;

/// The independently authenticated principal and signing-key context.
///
/// Identifiers use the existing public protocol identifier syntax. This context
/// contains no token and establishes no device-session or role-key authority.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OperationContext {
    principal_id: String,
    key_id: String,
}

impl OperationContext {
    pub fn new(principal_id: impl Into<String>, key_id: impl Into<String>) -> Result<Self, String> {
        let principal_id = principal_id.into();
        let key_id = key_id.into();
        validate_id(&principal_id)?;
        validate_id(&key_id)?;
        Ok(Self {
            principal_id,
            key_id,
        })
    }

    pub fn principal_id(&self) -> &str {
        &self.principal_id
    }

    pub fn key_id(&self) -> &str {
        &self.key_id
    }
}

/// Immutable expected coordinates for one operation and its service observation.
///
/// Kind and digest labels are opaque local identifiers, not a selected service
/// enum. Labels must explicitly distinguish raw-byte and protocol-object hashes;
/// matching them does not interpret or recompute those hashes. A future adapter
/// must supply these coordinates from its reviewed contract, not an untrusted
/// response. This type does not select cross-device recovery policy.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OperationBinding {
    context: OperationContext,
    operation_id: String,
    assignment_id: String,
    kind: String,
    digests: BTreeMap<String, String>,
}

impl OperationBinding {
    pub fn new(
        context: OperationContext,
        operation_id: impl Into<String>,
        assignment_id: impl Into<String>,
        kind: impl Into<String>,
        digests: BTreeMap<String, String>,
    ) -> Result<Self, String> {
        let operation_id = operation_id.into();
        let assignment_id = assignment_id.into();
        let kind = kind.into();
        validate_id(&operation_id)?;
        validate_id(&assignment_id)?;
        validate_id(&kind)?;
        if digests.is_empty() {
            return Err(
                "OPERATION_DIGESTS: at least one explicitly labelled digest is required".into(),
            );
        }
        for (label, digest) in &digests {
            validate_id(label)?;
            validate_digest(digest)?;
        }
        Ok(Self {
            context,
            operation_id,
            assignment_id,
            kind,
            digests,
        })
    }

    pub fn context(&self) -> &OperationContext {
        &self.context
    }

    pub fn operation_id(&self) -> &str {
        &self.operation_id
    }

    pub fn assignment_id(&self) -> &str {
        &self.assignment_id
    }

    pub fn kind(&self) -> &str {
        &self.kind
    }

    pub fn digests(&self) -> &BTreeMap<String, String> {
        &self.digests
    }
}

/// The original opaque body and binding. No mutable byte access is exposed.
pub struct PreparedOperation {
    binding: OperationBinding,
    body: Vec<u8>,
    body_sha256: String,
}

impl PreparedOperation {
    pub fn new(binding: OperationBinding, body: Vec<u8>) -> Result<Self, String> {
        if body.is_empty() || body.len() > MAX_OPERATION_BODY_BYTES {
            return Err("OPERATION_BODY: expected 1..4194304 exact bytes".into());
        }
        let body_sha256 = bytes_digest(&body);
        Ok(Self {
            binding,
            body,
            body_sha256,
        })
    }

    pub fn binding(&self) -> &OperationBinding {
        &self.binding
    }

    pub fn body(&self) -> &[u8] {
        &self.body
    }

    /// SHA-256 of the exact opaque body, independently of labelled object hashes.
    pub fn body_sha256(&self) -> &str {
        &self.body_sha256
    }
}

impl fmt::Debug for PreparedOperation {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("PreparedOperation")
            .field("binding", &self.binding)
            .field("body_bytes", &self.body.len())
            .field("body_sha256", &self.body_sha256)
            .finish_non_exhaustive()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OperationState {
    Ready,
    Unconfirmed,
    Pending,
    /// Attributed service handling only; originals remain independently verified.
    ServiceAccepted,
    Conflict,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ServiceOutcome {
    Pending,
    Accepted,
}

/// Local observations supplied by an adapter after dispatch.
///
/// These variants do not authenticate a transport, define server status codes,
/// or permit response fields to replace the operation's original binding.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Observation {
    Lost,
    Unavailable,
    NotFound,
    Receipt {
        binding: OperationBinding,
        outcome: ServiceOutcome,
    },
    ProviderConflict,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RecoveryAdvice {
    ReadyDispatch,
    Lookup,
    AcceptedVerifyOriginals,
    ConflictReview,
}

/// Borrowed exact material for the operation's only dispatch.
pub struct Dispatch<'a> {
    pub operation_id: &'a str,
    pub body: &'a [u8],
    pub body_sha256: &'a str,
    pub binding: &'a OperationBinding,
}

impl fmt::Debug for Dispatch<'_> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("Dispatch")
            .field("operation_id", &self.operation_id)
            .field("body_bytes", &self.body.len())
            .field("body_sha256", &self.body_sha256)
            .field("binding", &self.binding)
            .finish_non_exhaustive()
    }
}

/// One in-memory dispatch guard. Deliberately not cloneable or resettable.
#[derive(Debug)]
pub struct TrackedOperation {
    prepared: PreparedOperation,
    state: OperationState,
    service_acceptance_observed: bool,
}

impl TrackedOperation {
    pub fn new(prepared: PreparedOperation) -> Self {
        Self {
            prepared,
            state: OperationState::Ready,
            service_acceptance_observed: false,
        }
    }

    pub fn state(&self) -> OperationState {
        self.state
    }

    pub fn prepared(&self) -> &PreparedOperation {
        &self.prepared
    }

    /// Retain the fact of a matching accepted observation, even during conflict.
    /// This is attributed service handling, not independent protocol acceptance.
    pub fn service_acceptance_observed(&self) -> bool {
        self.service_acceptance_observed
    }

    pub fn recovery_advice(&self) -> RecoveryAdvice {
        match self.state {
            OperationState::Ready => RecoveryAdvice::ReadyDispatch,
            OperationState::Unconfirmed | OperationState::Pending => RecoveryAdvice::Lookup,
            OperationState::ServiceAccepted => RecoveryAdvice::AcceptedVerifyOriginals,
            OperationState::Conflict => RecoveryAdvice::ConflictReview,
        }
    }

    /// Mark dispatch intent before exposing bytes to the transport.
    ///
    /// The host must first durably journal that intent and the exact operation.
    /// Returning the material does not prove transmission. Every later call is
    /// refused, including after loss or `NotFound`; this core implements no retry.
    pub fn begin_dispatch(
        &mut self,
        current_context: &OperationContext,
    ) -> Result<Dispatch<'_>, String> {
        self.check_context(current_context)?;
        if self.state != OperationState::Ready {
            return Err(
                "OPERATION_DISPATCH: already dispatched; automatic or direct resend is unavailable"
                    .into(),
            );
        }
        self.state = OperationState::Unconfirmed;
        Ok(Dispatch {
            operation_id: self.prepared.binding.operation_id(),
            body: self.prepared.body(),
            body_sha256: self.prepared.body_sha256(),
            binding: self.prepared.binding(),
        })
    }

    /// Admit only observations for the original context and complete binding.
    ///
    /// Errors preserve state. Loss/unavailability/missing status cannot erase
    /// known handling or a conflict. An accepted result cannot regress to
    /// pending, and no receipt resolves an explicit provider conflict here.
    pub fn observe(
        &mut self,
        current_context: &OperationContext,
        observation: Observation,
    ) -> Result<OperationState, String> {
        self.check_context(current_context)?;
        if self.state == OperationState::Ready {
            return Err("OPERATION_OBSERVATION: no dispatch has begun".into());
        }
        match observation {
            Observation::Lost | Observation::Unavailable | Observation::NotFound => {}
            Observation::ProviderConflict => self.state = OperationState::Conflict,
            Observation::Receipt { binding, outcome } => {
                if binding != self.prepared.binding {
                    return Err(
                        "OPERATION_BINDING: observation differs from the complete original binding"
                            .into(),
                    );
                }
                if outcome == ServiceOutcome::Accepted {
                    self.service_acceptance_observed = true;
                }
                if self.state != OperationState::Conflict {
                    match outcome {
                        ServiceOutcome::Accepted => self.state = OperationState::ServiceAccepted,
                        ServiceOutcome::Pending
                            if self.state != OperationState::ServiceAccepted =>
                        {
                            self.state = OperationState::Pending;
                        }
                        ServiceOutcome::Pending => {}
                    }
                }
            }
        }
        Ok(self.state)
    }

    fn check_context(&self, current_context: &OperationContext) -> Result<(), String> {
        if current_context != self.prepared.binding.context() {
            return Err(
                "OPERATION_CONTEXT: current principal or key differs from the original operation"
                    .into(),
            );
        }
        Ok(())
    }
}

/// Check an explicitly raw-byte SHA-256 reference against retrieved originals.
///
/// A canonical/protocol digest must not be passed as a raw-byte reference.
/// Matching bytes proves no signature, trusted identity, contractual validity,
/// media acquisition, service acceptance or complete history.
pub fn verify_exact_bytes(expected_raw_sha256: &str, bytes: &[u8]) -> Result<(), String> {
    validate_digest(expected_raw_sha256)?;
    if bytes_digest(bytes) != expected_raw_sha256 {
        return Err("OPERATION_ORIGINAL: exact bytes differ from the raw SHA-256 reference".into());
    }
    Ok(())
}
