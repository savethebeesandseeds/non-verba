# Third-party materials

The root AGPL-3.0-only license covers project-owned material. It does not replace
the terms or provenance of the following external materials, nor the licenses of
dependencies installed by the build tools. Dependency packages remain separately
licensed under their own notices and license files.

| Material | Location and provenance |
| --- | --- |
| Primer Octicons GitHub icon | Homepage inline SVG; MIT notice in [LICENSES/Primer-Octicons-MIT.txt](LICENSES/Primer-Octicons-MIT.txt) and beside the SVG |
| IGS/BKG broadcast navigation excerpt | `code/crates/nonverba-core/src/location_proof/position/importer/igs-2026270-excerpt.rnx`; [data notice](LICENSES/IGS-BKG-navigation-notice.txt) |
| Google public Android attestation root certificates | `code/crates/nonverba-core/src/android_attestation/google-roots-2026.json`; [trust-anchor notice](LICENSES/Google-attestation-roots-notice.txt) |
| RTKLIB-generated numerical test vectors | `code/crates/nonverba-core/src/location_proof/position/rtklib-reference.json` and `rtklib-rollover-reference.json`; [fixture notice](LICENSES/RTKLIB-fixtures-notice.txt) |
| zune-jpeg progressive JPEG regression fixture | `code/crates/nonverba-core/tests/fixtures/camera-quality/progressive-dri-420.hex.txt`; exact synthetic bytes from `zune-jpeg` 0.5.15 `src/mcu_prog.rs`, with [provenance](code/crates/nonverba-core/tests/fixtures/camera-quality/README.md) and the selected [Zlib license](code/crates/nonverba-core/tests/fixtures/camera-quality/LICENSE-ZLIB.txt) |

The navigation excerpt is external satellite-navigation data, not a phone's
sensor evidence. Root certificates contain public verification keys, not private
signing keys. RTKLIB vectors are mathematical synthetic inputs and outputs, not
observations at a private physical location. Public synthetic contract vectors
and their migration provenance are described in their fixture READMEs.
