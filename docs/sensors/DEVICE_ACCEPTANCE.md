# Physical sensor acceptance checklist

This is a procedure for collecting evidence on an actual Android device. It does
not record a completed run. Use the documented [USB transport](../development/USB_DEBUGGING.md)
and [managed container](../development/CONTAINER_PLAN.md); select an explicitly
authorized physical device and retain results outside the source tree.

1. Record the device capabilities and the APK/source identity. Verify the APK
   and expected signer before installation. An unavailable capability is an
   explicit result, not permission to weaken a request.
2. Enroll the exact purpose-specific keys through an independent requester.
   Evaluate attestation against independently obtained trust data. Keep signing
   keys and actual enrollment/capture records private.
3. Create and independently retain a fresh request before capture. Confirm exact
   policy, expiry, key pins and the terms displayed to the operator.
4. Test camera, microphone and location separately under the chosen policies.
   Keep original JPEG/WAV/COSE bytes and independently observed receipts. Verify
   each artifact with the original request and trusted keys.
5. Test a composed camera/location request with both key identities and the
   binding to the complete final JPEG. Verify the original request, both artifacts
   and the requester receipt before recording acceptance.
6. Exercise refusal paths: denied permission, unsupported policy, cancellation,
   expiry, invalid or stale location, changed identity, missing artifact and
   duplicate local acceptance. Retain the actual error and its scope.
7. Repeat retained-evidence lookup and verification after reload. Distinguish
   historical verification from fresh acceptance and from global replay prevention.
8. Report each observation with its exact request profile, software version and
   limitations. A GPS attempt report is a failure observation; key attestation
   and signatures do not establish sensor truth.

## Evidence quality for each result

Retain enough context to reproduce the exact claim without treating later
success as proof that an earlier failure never occurred:

- Record the source revision and relevant uncommitted changes, tested package
  identity/signer, device/Android version, request profile, attempt/session IDs
  and whether input was physical, synthetic or a same-device demo.
- Keep the independently retained original request and trusted pins, exact
  exported artifact bytes/hashes, requester transcript/receipt where applicable,
  verifier inputs/results and any transfer comparison. A transfer hash checks
  byte preservation; the verifier establishes signature and binding separately.
- Separate acquisition outcome, artifact integrity, requested policy result,
  local acceptance and quality guidance. A missing signed artifact is an explicit
  outcome. Keep unsigned diagnostics and unobserved causes labelled accordingly;
  retain camera and GPS component outcomes separately for composed attempts.
- Distinguish terminal elapsed duration, observation span, last callback offset,
  device wall-clock claims and independently observed arrival. Record unavailable
  timing as unknown rather than substituting a later inspection time.
- Preserve failed and corrected checks with their exact scope. Record whether
  retention was checked after page reload, controlled app restart, interruption
  during collection/write/signing or power loss; those are different results.
  Include final observed resource cleanup and anything left unverified.

The [current checkpoint](STATUS.md#current-workstream-checkpoint--14-october-2026)
lists completed milestones and open physical cases. One saved camera-quality
report, one externally verified local audio demo and controlled GPS retention
checks do not complete this matrix. Physical independent-requester trials remain
deferred until a second device is available; new sensor work needs its own
bounded authorization.

User evidence may contain faces, voices, precise locations and device identifiers.
Do not commit raw phone captures, signing vaults, retrieval manifests or machine
logs. Publish only deliberately reviewed results with enough context to support
the precise claim being made.
