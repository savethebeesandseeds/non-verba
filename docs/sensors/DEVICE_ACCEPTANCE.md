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

User evidence may contain faces, voices, precise locations and device identifiers.
Do not commit raw phone captures, signing vaults, retrieval manifests or machine
logs. Publish only deliberately reviewed results with enough context to support
the precise claim being made.
