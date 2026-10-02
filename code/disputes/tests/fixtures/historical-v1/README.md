# Historical version-1 failure replay

These three files preserve a version-1 synthetic analysis specification, portable
failure record and independent public test trust bindings from 29 September 2026.
They are copied byte-for-byte so tests can detect changes that break historical
serialization or replay.

The case uses authored toy contract/evidence and test-party identities. A local
SmolLM2 plumbing probe reached its output-token limit with unfinished JSON. The
record remains `FAILED`, and is not eligible as a successful real local analysis.
Its retained raw model output is untrusted generated test material. It supplies
no evidence of reasoning quality, fairness, payment authority or real-world facts.

Only these test inputs are published. Runtime resource handoffs, server logs,
administrator settings and the rest of the original capture are excluded.
`provenance.json` records original snapshot, SHA-256 and byte length. No private
participant key, vault, passphrase or sensor capture is included.

Project-authored material is licensed under AGPL-3.0-only; see the root LICENSE.
