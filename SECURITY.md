# Security

This project is a prototype. Review the [sensor trust boundaries](docs/sensors/SECURITY.md)
and [assignment threat model](docs/requests/THREAT_MODEL.md). Source availability,
an app signature, and key enrollment are distinct from authenticated physical
sensor readings. No license or repository label establishes those properties.

The [security design record](docs/SECURITY_DESIGN_RECORD.md) maps the CIA triad
and related properties to current mechanisms, assumptions, unresolved gaps and
the behavior required when assumptions fail.

Do not put credentials, personal evidence, device identities, or sensitive
exploit details in public issues. Use the repository's private vulnerability
reporting channel if available, or arrange a private channel with a maintainer.
Describe affected versions, prerequisites, impact, and a minimal synthetic
reproduction when possible.

Release signing keys remain private. Public test keys and generated fixture
credentials are intentionally unsuitable for production. Obtain software and
verification trust material independently of the evidence being checked.
