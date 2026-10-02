# Contributing

Contributions to project-owned material are accepted under `AGPL-3.0-only`
unless explicitly agreed otherwise. Submit only material you have the right to
license on those terms. Identify third-party material and preserve its license,
attribution, and provenance.

Keep changes focused on a specific protocol, application, or verifier boundary.
Use the managed Linux container and run the existing checks relevant to the
change. Changes to signed formats or verification policy need documented
compatibility and meaningful adversarial coverage. Report physical-device
results separately from synthetic or browser tests.

Do not commit signing credentials, API tokens, private keys, personal captures,
local enrollment/trust records, build outputs, model weights, or operational
journals. The deterministic keys in identified test fixtures are public test
keys and must never become production identities.

Forks are welcome. Preserve legal notices and identify modifications as required
by AGPLv3. Clearly state the fork's maintainers, protocol changes, and source
location; do not imply that a modified version is an official Non-verba release.
Passing tests or publishing source is not a certification of fair behavior or
physical sensor authenticity.
