# Sensor implementation status

The Android and browser evidence application is a development implementation.
Its source is public under the repository license. Publishing the implementation
does not establish independent sensor authenticity, production readiness or a
new physical-device acceptance result.

| Component | Implemented boundary | Remaining limit |
| --- | --- | --- |
| Camera | Challenge-bound C2PA JPEGs, native Camera2 acquisition metadata and requester receipt/acceptance | A signature does not prove the scene, pixel origin on a compromised device or truthful wall-clock time |
| Microphone | Browser capture and native AAudio capture with fresh acoustic challenges, signed WAVs and retained requester observations | Acoustic support varies; modified clients and live external replay remain threats |
| Location | Request-bound COSE traces, native acquisition policy, raw GNSS observations and optional independently supplied navigation verification | Mathematical consistency does not establish satellite/RF authenticity or physical location |
| Key enrollment | Separate purpose-specific Android identities and independently evaluated attestation policy | Key-generation attestation does not authenticate later sensor measurements or current application execution |
| Requester workflow | Pairing before request release, complete-artifact verification, retained records and atomic local acceptance | Local ledgers do not provide global replay prevention across devices, cleared storage or hidden histories |
| Agent integration | Shared Rust verification and browser workflow adapters | A durable MCP/server workflow and its deployment trust boundaries remain separate work |

The stronger native/raw request profiles are explicit policies. Unsupported
capabilities must reject the request rather than silently switch to a reduced
profile. Legacy records retain their original signed rules.

GPS attempt reports describe a failed attempt, never a successful measurement.
Timing diagnostics help identify a freshness rejection but remain unsigned and
do not authorize capture. No privacy, freshness or timing rule is relaxed by
the repository unification.

Start with [the evidence app guide](README.md),
[complete sensor policies](COMPLETE_SENSOR_PACKAGES.md),
[attestation verification](KEY_ATTESTATION_VERIFIER.md) and
[the security model](SECURITY.md). The [validation guide](VALIDATION.md) and
[physical acceptance checklist](DEVICE_ACCEPTANCE.md) distinguish software
checks from evidence obtained on an actual device.
