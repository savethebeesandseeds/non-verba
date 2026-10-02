# Synthetic workflow vectors

These six cases retain the exact signed bundle, independent trust configuration
and verifier report from workflow tests dated 28 September 2026:

| Case | Regression distinction |
| --- | --- |
| `happy-lifecycle` | Endorsements, synthetic completion and payee receipt |
| `late-context` | Active mediator fee and separately disputed expenses |
| `partial` | Missing Agreement endorsement does not create consent |
| `physical` | A synthetic physical-quality dispute does not erase an authorized digital entitlement |
| `settlement` | Scoped Requester/Operator release preserves a separate mediator fee |
| `reversal` | A named receipt grant is partially reversed without revoking another grant |

All cases are authored test scenarios. `physical` is a synthetic scenario name,
not captured camera, microphone or location evidence. Most cases use explicitly
public deterministic test keys. The happy-lifecycle harness used temporary
OS-generated participant keys; only public exchange artifacts are included.
Private vaults, signing keys, passphrases, signing guards and operational logs
are excluded. No live payment, custody, performance guarantee or independent
human participation is represented.

`provenance.json` records byte-identical migration and the SHA-256/length of each
input. Project-authored material is licensed under AGPL-3.0-only; see the root
LICENSE. These fixtures must never be used for real assignments.
